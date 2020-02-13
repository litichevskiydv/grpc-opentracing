const path = require("path");
const grpc = require("grpc");
const { GrpcHostBuilder } = require("grpc-host-builder");
const { loadSync } = require("grpc-pbf-loader").packageDefinition;

const { clientInterceptor, serverInterceptor } = require("../src/index");

const {
  HelloRequest: ServerHelloRequest,
  HelloResponse: ServerHelloResponse,
  ErrorRequest: ServerErrorRequest
} = require("./generated/server/greeter_pb").v1;
const {
  HelloRequest: ClientHelloRequest,
  ErrorRequest: ClientErrorRequest,
  Event,
  GreeterClient
} = require("./generated/client/greeter_client_pb").v1;

grpc.setLogVerbosity(grpc.logVerbosity.ERROR + 1);

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

/**
 * @param {function(GrpcHostBuilder):void} [configurator]
 * @returns {import("grpc").Server}
 */
const createServer = configurator => {
  const hostBuilder = new GrpcHostBuilder();
  if (configurator) configurator(hostBuilder);

  return hostBuilder
    .addService(packageObject.v1.Greeter.service, {
      sayHello: call => {
        const request = new ServerHelloRequest(call.request);

        const event = request.event;
        event.id = 1;
        return new ServerHelloResponse({ event });
      },
      throwError: () => {
        throw new Error("Something went wrong");
      }
    })
    .bind(grpcBind)
    .build();
};

/**
 * @returns {Promise<import("./generated/client/greeter_client_pb").v1.HelloResponse>}
 */
const sayHello = () => {
  const event = new Event();
  event.setName("Lucky Every");

  const request = new ClientHelloRequest();
  request.setEvent(event);

  return client.sayHello(request);
};

beforeEach(() => {
  client = new GreeterClient(grpcBind, grpc.credentials.createInsecure(), { interceptors: [clientInterceptor] });
});

afterEach(() => {
  if (client) client.close();
  if (server) server.forceShutdown();
});

test("Must trace single call on the client side", async () => {
  // Given
  server = createServer();

  // When
  await sayHello();
});
