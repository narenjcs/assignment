import type { Writable } from 'node:stream';

// AWS Lambda's response-streaming runtime injects a global `awslambda` object before invoking
// the handler. `@types/aws-lambda` types that global ambiently but never constructs it — outside
// the real Lambda runtime (i.e. under Vitest) nothing provides it, so any module that references
// `awslambda.*` at import time (src/api/handler.ts) or call time (src/api/respond.ts) would throw
// a ReferenceError. This stub is faithful enough for tests: `HttpResponseStream.from` just tags
// the given writable with its metadata and returns it unchanged (so a real `PassThrough` works),
// and `streamifyResponse` returns the inner handler unwrapped so tests can call it directly.

export interface HttpResponseStreamMetadata {
  statusCode: number;
  headers: Record<string, string>;
}

interface TaggedWritable {
  __metadata?: HttpResponseStreamMetadata;
}

function httpResponseStreamFrom(
  writable: Writable,
  metadata: HttpResponseStreamMetadata,
): Writable {
  (writable as unknown as TaggedWritable).__metadata = metadata;
  return writable;
}

function streamifyResponse<T>(handler: T): T {
  return handler;
}

/** Reads back the metadata a test's stub `HttpResponseStream.from` call attached to a stream. */
export function readStreamMetadata(stream: Writable): HttpResponseStreamMetadata | undefined {
  return (stream as unknown as TaggedWritable).__metadata;
}

(globalThis as unknown as Record<'awslambda', unknown>).awslambda = {
  HttpResponseStream: { from: httpResponseStreamFrom },
  streamifyResponse,
};
