const path = require("path");
const grpc = require("@grpc/grpc-js");
const opentracing = require("opentracing");
const { GrpcHostBuilder } = require("grpc-host-builder");
const { loadSync } = require("grpc-pbf-loader").packageDefinition;

const { clientInterceptor, serverInterceptor } = require("../src/index");

const {
  HelloRequest: ServerHelloRequest,
  HelloResponse: ServerHelloResponse,
  ErrorRequest: ServerErrorRequest,
} = require("./generated/server/greeter_pb").v1;
const {
  HelloRequest: ClientHelloRequest,
  ErrorRequest: ClientErrorRequest,
  TransactionRequest: ClientTransactionRequest,
  Event,
  GreeterClient,
} = require("./generated/client/greeter_client_pb").v1;
const { GreeterClient: GreeterRawLevelClient } = require("./generated/client/greeter_grpc_pb");

const LocalTracer = require("./localTracer/tracer");
const LocalSpan = require("./localTracer/span");

const grpcBind = "0.0.0.0:3002";
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
 * @param {function(GrpcHostBuilder):void} [configurator]
 * @returns {import("@grpc/grpc-js").Server}
 */
const createServer = (configurator) => {
  const hostBuilder = new GrpcHostBuilder();
  if (configurator) configurator(hostBuilder);

  return hostBuilder
    .useLoggersFactory(() => ({ error: jest.fn() }))
    .addService(packageObject.v1.Greeter.service, {
      sayHello: async (call) => {
        const request = new ServerHelloRequest(call.request);

        const event = request.event;
        event.id = 1;
        return new ServerHelloResponse({ event });
      },
      throwError: () => {
        throw new Error("Something went wrong");
      },
      performTransaction: async () => {
        await new Promise((resolve) => {
          setTimeout(() => resolve(), 1000);
        });

        return {};
      },
    })
    .bind(grpcBind)
    .buildAsync();
};

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
  try {
    await client.throwError(new ClientErrorRequest(), null, callOptions);
  } catch (error) {}
};

/**
 * @returns {Promise<void>}
 */
const startAndCancelTransaction = async () => {
  const rawLevelClient = new GreeterRawLevelClient(grpcBind, grpc.credentials.createInsecure(), {
    interceptors: [clientInterceptor],
  });

  try {
    await new Promise((resolve, reject) => {
      const call = rawLevelClient.performTransaction(new ClientTransactionRequest(), (error, response) => {
        if (error) reject(error);
        else resolve(response);
      });

      setTimeout(() => call.cancel(), 100);
    });
  } catch (error) {}

  rawLevelClient.close();
};

beforeEach(() => {
  client = new GreeterClient(grpcBind, grpc.credentials.createInsecure(), { interceptors: [clientInterceptor] });
});

afterEach(() => {
  client.close();
  server.forceShutdown();
  tracer.clear();
});

test("Must trace single successful call on the client side", async () => {
  // Given
  server = await createServer();

  // When
  await sayHello();

  // Then
  expect(tracer.spans.size).toBe(1);

  const expectedSpanId = 0;
  const expectedSpan = new LocalSpan(expectedSpanId, "gRPC call to /v1.Greeter/SayHello").finish();
  expect(tracer.spans.get(expectedSpanId)).toEqual(expectedSpan);
});

test("Must trace single errored call on the client side", async () => {
  // Given
  server = await createServer();

  // When
  await throwError();

  // Then
  expect(tracer.spans.size).toBe(1);

  const expectedSpanId = 0;
  const expectedSpan = new LocalSpan(expectedSpanId, "gRPC call to /v1.Greeter/ThrowError")
    .setTag(opentracing.Tags.ERROR, true)
    .setTag(opentracing.Tags.SAMPLING_PRIORITY, 1)
    .log({ event: "error", code: "INTERNAL", message: "Unhandled exception has occurred" })
    .finish();
  expect(tracer.spans.get(expectedSpanId)).toEqual(expectedSpan);
});

test("Must link client and server spans together in the single call", async () => {
  // Given
  server = await createServer((x) => x.addInterceptor(serverInterceptor));

  // When
  await sayHello();

  // Then
  expect(tracer.spans.size).toBe(2);

  const expectedClientSpanId = 0;
  const expectedClientSpan = new LocalSpan(expectedClientSpanId, "gRPC call to /v1.Greeter/SayHello")
    .withChildSpans(
      new LocalSpan(1, "/v1.Greeter/SayHello")
        .log({ "gRPC request": { event: { id: 0, name: "Lucky Every" } } })
        .log({ "gRPC response": { event: { id: 1, name: "Lucky Every" } } })
        .finish()
    )
    .finish();
  expect(tracer.spans.get(expectedClientSpanId)).toEqual(expectedClientSpan);
});

test("Must trace two consecutive calls correctly", async () => {
  // Given
  server = await createServer((x) => x.addInterceptor(serverInterceptor));

  // When
  await sayHello("Tom");
  await sayHello("Jerry");

  // Then
  expect(tracer.spans.size).toBe(4);

  const expectedClientSpanIdForTom = 0;
  const expectedClientSpanForTom = new LocalSpan(expectedClientSpanIdForTom, "gRPC call to /v1.Greeter/SayHello")
    .withChildSpans(
      new LocalSpan(1, "/v1.Greeter/SayHello")
        .log({ "gRPC request": { event: { id: 0, name: "Tom" } } })
        .log({ "gRPC response": { event: { id: 1, name: "Tom" } } })
        .finish()
    )
    .finish();
  expect(tracer.spans.get(expectedClientSpanIdForTom)).toEqual(expectedClientSpanForTom);

  const expectedClientSpanIdForJerry = 2;
  const expectedClientSpanForJerry = new LocalSpan(expectedClientSpanIdForJerry, "gRPC call to /v1.Greeter/SayHello")
    .withChildSpans(
      new LocalSpan(3, "/v1.Greeter/SayHello")
        .log({ "gRPC request": { event: { id: 0, name: "Jerry" } } })
        .log({ "gRPC response": { event: { id: 1, name: "Jerry" } } })
        .finish()
    )
    .finish();
  expect(tracer.spans.get(expectedClientSpanIdForJerry)).toEqual(expectedClientSpanForJerry);
});

test("Must trace the call that did not fit into the deadline", async () => {
  // Given
  server = await createServer();

  // When
  await throwError({ deadline: 10 });

  // Then
  expect(tracer.spans.size).toBe(1);

  const expectedSpanId = 0;
  const expectedSpan = new LocalSpan(expectedSpanId, "gRPC call to /v1.Greeter/ThrowError")
    .setTag(opentracing.Tags.ERROR, true)
    .setTag(opentracing.Tags.SAMPLING_PRIORITY, 1)
    .log({ event: "error", code: "DEADLINE_EXCEEDED", message: "Deadline exceeded" })
    .finish();
  expect(tracer.spans.get(expectedSpanId)).toEqual(expectedSpan);
});

test("Must trace cancelled call", async () => {
  // Given
  server = await createServer();

  // When
  await startAndCancelTransaction();

  // Then
  expect(tracer.spans.size).toBe(1);

  const expectedSpanId = 0;
  const expectedSpan = new LocalSpan(expectedSpanId, "gRPC call to /v1.Greeter/PerformTransaction")
    .setTag(opentracing.Tags.ERROR, true)
    .setTag(opentracing.Tags.SAMPLING_PRIORITY, 1)
    .log({ event: "error", code: "CANCELLED", message: "Cancelled on client" })
    .finish();
  expect(tracer.spans.get(expectedSpanId)).toEqual(expectedSpan);
});
