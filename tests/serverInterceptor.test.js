const path = require("path");
const grpc = require("@grpc/grpc-js");
const opentracing = require("opentracing");
const { GrpcHostBuilder } = require("grpc-host-builder");
const { loadSync } = require("grpc-pbf-loader").packageDefinition;

const { serverInterceptor } = require("../src/index");

const {
  HelloRequest: ServerHelloRequest,
  HelloResponse: ServerHelloResponse,
  ErrorRequest: ServerErrorRequest,
} = require("./generated/server/greeter_pb").v1;
const {
  Event,
  HelloRequest: ClientHelloRequest,
  ErrorRequest: ClientErrorRequest,
  GreeterClient,
} = require("./generated/client/greeter_client_pb").v1;

const LocalTracer = require("./localTracer/tracer");
const LocalSpan = require("./localTracer/span");

const grpcBind = "0.0.0.0:3001";
const packageObject = grpc.loadPackageDefinition(
  loadSync(path.join(__dirname, "./protos/greeter.proto"), {
    includeDirs: [path.join(__dirname, "./include/")],
  })
);
/** @type {import("@grpc/grpc-js").Server} */
let server = null;
/** @type {GreeterClient} */
let client = null;
const tracer = new LocalTracer();

grpc.setLogVerbosity(grpc.logVerbosity.ERROR + 1);
opentracing.initGlobalTracer(tracer);

/**
 * @returns {import("@grpc/grpc-js").Server}
 */
const createServer = () =>
  new GrpcHostBuilder()
    .useLoggersFactory(() => ({ error: jest.fn() }))
    .addInterceptor(serverInterceptor)
    .addService(packageObject.v1.Greeter.service, {
      sayHello: async (call) => {
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
      },
    })
    .bind(grpcBind)
    .buildAsync();

/**
 * @returns {GreeterClient}
 */
const createClient = () => new GreeterClient(grpcBind, grpc.credentials.createInsecure());

/**
 * @param {string} [name]
 * @returns {Promise<import("./generated/client/greeter_client_pb").v1.HelloResponse>}
 */
const sayHello = (name) => {
  const event = new Event();
  event.setName(name || "Lucky Every");

  const request = new ClientHelloRequest();
  request.setEvent(event);

  return client.sayHello(request);
};

/**
 * @param {import("@grpc/grpc-js").CallOptions} [callOptions]
 * @returns {Promise<void>}
 */
const throwError = async (callOptions) => {
  const request = new ClientErrorRequest();
  request.setSubject("Learning");

  await client.throwError(request, null, callOptions);
};

const prepareErrorMatchingObject = (innerErrorMessage) =>
  expect.objectContaining({
    message: "13 INTERNAL: Unhandled exception has occurred",
    details: [expect.objectContaining({ detail: innerErrorMessage })],
  });

afterEach(() => {
  client.close();
  server.forceShutdown();
  tracer.clear();
});

test("Must trace single successful call on the server side", async () => {
  // Given
  server = await createServer();
  client = createClient();

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
  const errorMessage = "Something went wrong";

  server = await createServer();
  client = createClient();

  // When, Then
  await expect(throwError()).rejects.toEqual(prepareErrorMatchingObject(errorMessage));

  expect(tracer.spans.size).toBe(1);

  const expectedSpanId = 0;
  const expectedSpan = new LocalSpan(expectedSpanId, "/v1.Greeter/ThrowError")
    .log({ "gRPC request": { subject: "Learning" } })
    .setTag(opentracing.Tags.ERROR, true)
    .setTag(opentracing.Tags.SAMPLING_PRIORITY, 1)
    .log(expect.objectContaining({ event: "error", message: errorMessage }))
    .finish();
  expect(tracer.spans.get(expectedSpanId)).toEqual(expectedSpan);
});

test("Must trace two consecutive calls correctly", async () => {
  // Given
  server = await createServer();
  client = createClient();

  // When
  await sayHello("Tom");
  await sayHello("Jerry");

  // Then
  expect(tracer.spans.size).toBe(2);

  const expectedClientSpanIdForTom = 0;
  const expectedClientSpanForTom = new LocalSpan(expectedClientSpanIdForTom, "/v1.Greeter/SayHello")
    .log({ "gRPC request": { event: { id: 0, name: "Tom" } } })
    .log({ "gRPC response": { event: { id: 84, name: "Tom" } } })
    .finish();
  expect(tracer.spans.get(expectedClientSpanIdForTom)).toEqual(expectedClientSpanForTom);

  const expectedClientSpanIdForJerry = 1;
  const expectedClientSpanForJerry = new LocalSpan(expectedClientSpanIdForJerry, "/v1.Greeter/SayHello")
    .log({ "gRPC request": { event: { id: 0, name: "Jerry" } } })
    .log({ "gRPC response": { event: { id: 74, name: "Jerry" } } })
    .finish();
  expect(tracer.spans.get(expectedClientSpanIdForJerry)).toEqual(expectedClientSpanForJerry);
});
