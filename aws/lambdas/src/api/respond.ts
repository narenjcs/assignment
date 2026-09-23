import type { Writable } from 'node:stream';
import { isDocIntelError } from '../lib/errors.js';

const JSON_HEADERS = { 'content-type': 'application/json' };
const SSE_HEADERS = { 'content-type': 'text/event-stream' };
const INTERNAL_ERROR_STATUS = 500;

/** Every response — success or error, buffered or streamed — carries these two headers. */
function baseHeaders(requestId: string, extra: Record<string, string>): Record<string, string> {
  return { 'x-request-id': requestId, 'cache-control': 'no-store', ...extra };
}

/** Writes a single buffered JSON response and closes the stream. */
export function writeJson(
  responseStream: Writable,
  requestId: string,
  statusCode: number,
  body: unknown,
): void {
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: baseHeaders(requestId, JSON_HEADERS),
  });
  stream.write(JSON.stringify(body));
  stream.end();
}

/** Opens the HTTP response as an SSE stream (status 200) and returns the writable to use. */
export function openSseStream(responseStream: Writable, requestId: string): Writable {
  return awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: baseHeaders(requestId, SSE_HEADERS),
  });
}

export interface ErrorEnvelope {
  statusCode: number;
  body: { error: { code: string; message: string; requestId: string } };
}

/** Maps any thrown error to the one error envelope shape used across the API (§10). */
export function toErrorEnvelope(requestId: string, error: unknown): ErrorEnvelope {
  if (isDocIntelError(error)) {
    return {
      statusCode: error.httpStatus,
      body: { error: { code: error.code, message: error.message, requestId } },
    };
  }
  return {
    statusCode: INTERNAL_ERROR_STATUS,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } },
  };
}

/** Writes the mapped error envelope for a pre-stream failure (never used mid-SSE-stream). */
export function writeErrorResponse(
  responseStream: Writable,
  requestId: string,
  error: unknown,
): void {
  const { statusCode, body } = toErrorEnvelope(requestId, error);
  writeJson(responseStream, requestId, statusCode, body);
}
