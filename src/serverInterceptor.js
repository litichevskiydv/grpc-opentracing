const opentracing = require("opentracing");
const { serializeError } = require("serialize-error");
const { defaultContext } = require("processing-context");

/**
 * @param {import("@grpc/grpc-js").ServerUnaryCall | import("@grpc/grpc-js").ServerWritableStream | import("@grpc/grpc-js").ServerReadableStream | import("@grpc/grpc-js").ServerDuplexStream} call
 * @param {import("@grpc/grpc-js").MethodDefinition} methodDefinition
 * @param {Function} next
 * @returns {Promise<any>}
 */
module.exports = async function (call, methodDefinition, next) {
  const tracer = opentracing.globalTracer();

  const parentSpanContext = tracer.extract(opentracing.FORMAT_HTTP_HEADERS, call.metadata.getMap());
  const span = tracer.startSpan(methodDefinition.path, { childOf: parentSpanContext });
  defaultContext.set("currentSpan", span);

  if (call.request) span.log({ "gRPC request": serializeError(call.request) });

  try {
    const response = await next(call);
    if (response) span.log({ "gRPC response": serializeError(response) });

    return response;
  } catch (error) {
    span.setTag(opentracing.Tags.ERROR, true);
    span.setTag(opentracing.Tags.SAMPLING_PRIORITY, 1);
    span.log({ event: "error", "error.object": serializeError(error), message: error.message, stack: error.stack });

    throw error;
  } finally {
    span.finish();
  }
};
