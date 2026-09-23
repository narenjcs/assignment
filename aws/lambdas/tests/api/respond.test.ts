import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../src/lib/errors.js';
import {
  openSseStream,
  toErrorEnvelope,
  writeErrorResponse,
  writeJson,
} from '../../src/api/respond.js';
import { readStreamMetadata } from '../setup/awslambda-global.js';

async function readAll(stream: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

describe('writeJson', () => {
  it('writes the status, base headers and JSON body, then ends the stream', async () => {
    const stream = new PassThrough();
    const collected = readAll(stream);
    writeJson(stream, 'req-1', 201, { hello: 'world' });

    expect(await collected).toBe(JSON.stringify({ hello: 'world' }));
    const metadata = readStreamMetadata(stream);
    expect(metadata?.statusCode).toBe(201);
    expect(metadata?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-request-id': 'req-1',
      'cache-control': 'no-store',
    });
  });
});

describe('openSseStream', () => {
  it('opens with status 200 and an SSE content type, and returns the writable', () => {
    const stream = new PassThrough();
    const opened = openSseStream(stream, 'req-2');

    expect(opened).toBe(stream);
    const metadata = readStreamMetadata(stream);
    expect(metadata?.statusCode).toBe(200);
    expect(metadata?.headers['content-type']).toBe('text/event-stream');
  });
});

describe('toErrorEnvelope', () => {
  it('maps a DocIntelError to its own status code and code', () => {
    const envelope = toErrorEnvelope(
      'req-3',
      new NotFoundError('JOB_NOT_FOUND', 'Job x not found'),
    );
    expect(envelope.statusCode).toBe(404);
    expect(envelope.body.error).toEqual({
      code: 'JOB_NOT_FOUND',
      message: 'Job x not found',
      requestId: 'req-3',
    });
  });

  it('maps an unknown error to 500 INTERNAL_ERROR, hiding the original message', () => {
    const envelope = toErrorEnvelope('req-4', new Error('some internal detail'));
    expect(envelope.statusCode).toBe(500);
    expect(envelope.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId: 'req-4',
    });
  });
});

describe('writeErrorResponse', () => {
  it('writes the mapped error envelope as JSON', async () => {
    const stream = new PassThrough();
    const collected = readAll(stream);
    writeErrorResponse(stream, 'req-5', new NotFoundError('JOB_NOT_FOUND', 'Job y not found'));

    const body = JSON.parse(await collected) as { error: { code: string } };
    expect(body.error.code).toBe('JOB_NOT_FOUND');
    expect(readStreamMetadata(stream)?.statusCode).toBe(404);
  });
});
