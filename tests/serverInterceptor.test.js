const path = require("path");
const grpc = require("grpc");
const opentracing = require("opentracing");
const { GrpcHostBuilder } = require("grpc-host-builder");
const { loadSync } = require("grpc-pbf-loader").packageDefinition;

const { serverInterceptor } = require("../src/index");

const {
  HelloRequest: ServerHelloRequest,
  HelloResponse: ServerHelloResponse,
  ErrorRequest: ServerErrorRequest
} = require("./generated/server/greeter_pb").v1;
const {
  Event,
  HelloRequest: ClientHelloRequest,
  ErrorRequest: ClientErrorRequest,
  GreeterClient
} = require("./generated/client/greeter_client_pb").v1;

const LocalTracer = require("./localTracer/tracer");
const LocalSpan = require("./localTracer/span");

const grpcBind = "0.0.0.0:3000";
const packageObject = grpc.loadPackageDefinition(
  loadSync(path.join(__dirname, "./protos/greeter.proto"), {
    includeDirs: [path.join(__dirname, "./include/")]
  })
);
/** @type {import("grpc").Server} */
let server = null;
/** @type {GreeterClient} */
let client = null;
const tracer = new LocalTracer();

grpc.setLogVerbosity(grpc.logVerbosity.ERROR + 1);
opentracing.initGlobalTracer(tracer);

/**
 * @returns {import("grpc").Server}
 */
const createServer = () =>
  new GrpcHostBuilder()
    .useLoggersFactory(() => ({ error: jest.fn() }))
    .addInterceptor(serverInterceptor)
    .addService(packageObject.v1.Greeter.service, {
      sayHello: async call => {
        const request = new ServerHelloRequest(call.request);

        const event = request.event;
        event.id = event.name.charCodeAt(0);
        return new ServerHelloResponse({ event });
      },
      throwError: () => {
        throw new Error("Something went wrong");
      },
      performTransaction: () => {
        return {};
      }
    })
    .bind(grpcBind)
    .build();

/**
 * @param {string} [name]
 * @returns {Promise<import("./generated/client/greeter_client_pb").v1.HelloResponse>}
 */
const sayHello = name => {
  const event = new Event();
  event.setName(name || "Lucky Every");

  const request = new ClientHelloRequest();
  request.setEvent(event);

  return client.sayHello(request);
};

/**
 * @param {import("grpc").CallOptions} [callOptions]
 * @returns {Promise<void>}
 */
const throwError = async callOptions => {
  const request = new ClientErrorRequest();
  request.setSubject("Learning");

  await client.throwError(request, null, callOptions);
};

beforeEach(() => {
  client = new GreeterClient(grpcBind, grpc.credentials.createInsecure());
});

afterEach(() => {
  if (client) client.close();
  if (server) server.forceShutdown();

  tracer.clear();
});

test("Must trace single successful call on the server side", async () => {
  // Given
  server = createServer();

  // When
  await sayHello();

  // Then
  expect(tracer.spans.size).toBe(1);

  const expectedSpanId = 0;
  const expectedSpan = new LocalSpan(expectedSpanId, "/v1.Greeter/SayHello")
    .log({ "gRPC request": { event: { id: 0, name: "Lucky Every" } } })
    .log({ "gRPC response": { event: { id: 76, name: "Lucky Every" } } })
    .finish();
  expect(tracer.spans.get(expectedSpanId)).toEqual(expectedSpan);
});

test("Must trace single errored call on the server side", async () => {
  // Given
  server = createServer();

  // When, Then
  await expect(throwError()).rejects.toEqual(new Error("13 INTERNAL: Something went wrong"));

  expect(tracer.spans.size).toBe(1);

  const expectedSpanId = 0;
  const expectedSpan = new LocalSpan(expectedSpanId, "/v1.Greeter/ThrowError")
    .log({ "gRPC request": { subject: "Learning" } })
    .setTag(opentracing.Tags.ERROR, true)
    .setTag(opentracing.Tags.SAMPLING_PRIORITY, 1)
    .log(expect.objectContaining({ event: "error", message: "Something went wrong" }))
    .finish();
  expect(tracer.spans.get(expectedSpanId)).toEqual(expectedSpan);
});
