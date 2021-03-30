const { InterceptingCall, status: grpcStatus } = require("@grpc/grpc-js");
const opentracing = require("opentracing");
const { defaultContext } = require("processing-context");

const grpcStatusesByCodes = new Map(Object.entries(grpcStatus).map(([key, value]) => [value, key]));

/**
 * @param {{method_definition: import("@grpc/grpc-js").MethodDefinition}} options
 * @param {Function} nextCall
 * @returns {InterceptingCall}
 */
module.exports = function (options, nextCall) {
  return new InterceptingCall(nextCall(options), {
    /**
     * @param {import("@grpc/grpc-js").Metadata} metadata
     * @param {import("@grpc/grpc-js").Listener} listener
     * @param {Function} next
     */
    start: function (metadata, listener, next) {
      const tracer = opentracing.globalTracer();
      const span = tracer.startSpan(`gRPC call to ${options.method_definition.path}`, {
        childOf: defaultContext.get("currentSpan"),
      });

      const headers = {};
      tracer.inject(span, opentracing.FORMAT_HTTP_HEADERS, headers);
      for (const key in headers) metadata.set(key, headers[key]);

      next(metadata, {
        /**
         * @param {import("@grpc/grpc-js").StatusObject} status
         * @param {Function} next
         */
        onReceiveStatus: function (status, next) {
          if (status.code !== grpcStatus.OK) {
            span.setTag(opentracing.Tags.ERROR, true);
            span.setTag(opentracing.Tags.SAMPLING_PRIORITY, 1);
            span.log({
              event: "error",
              code: grpcStatusesByCodes.get(status.code) || grpcStatusesByCodes.get(grpcStatus.INTERNAL),
              message: status.details,
            });
          }

          span.finish();
          next(status);
        },
      });
    },
  });
};
