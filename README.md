# grpc-opentracing

[![npm version](https://badge.fury.io/js/grpc-opentracing.svg)](https://www.npmjs.com/package/grpc-opentracing)
[![npm downloads](https://img.shields.io/npm/dt/grpc-opentracing.svg)](https://www.npmjs.com/package/grpc-opentracing)
[![dependencies](https://img.shields.io/david/litichevskiydv/grpc-opentracing.svg)](https://www.npmjs.com/package/grpc-opentracing)
[![dev dependencies](https://img.shields.io/david/dev/litichevskiydv/grpc-opentracing.svg)](https://www.npmjs.com/package/grpc-opentracing)
[![Build Status](https://github.com/litichevskiydv/grpc-opentracing/actions/workflows/ci.yaml/badge.svg?branch=master)](https://github.com/litichevskiydv/grpc-opentracing/actions/workflows/ci.yaml)
[![Coverage Status](https://coveralls.io/repos/github/litichevskiydv/grpc-opentracing/badge.svg?branch=master)](https://coveralls.io/github/litichevskiydv/grpc-opentracing?branch=master)

Interceptors for client and server to track calls through opentracing

## This was migrated to https://github.com/litichevskiydv/grpc-bay
This repository has been moved to the unified "monorepo". You can find the source under [/packages/grpc-opentracing](https://github.com/litichevskiydv/grpc-bay/tree/master/packages/grpc-opentracing).

# Install

`npm i grpc-opentracing`

# Usage

```javascript
const { clientInterceptor, serverInterceptor } = require("grpc-opentracing");

/*...*/

const server = new GrpcHostBuilder()
  /*...*/
  .addInterceptor(serverInterceptor)
  /*...*/
  .bind(grpcBind)
  .build();

/*...*/
const client = new ServerClient(grpcBind, grpc.credentials.createInsecure(), { interceptors: [clientInterceptor] });
```
