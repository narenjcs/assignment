import { PassThrough } from 'node:stream';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiHandlerModule from '../../src/api/handler.js';

// api/handler.ts builds its AWS SDK deps from env vars at module import time (cold start,
// DEVELOPMENT.md §3), so tests stub env + reset modules before each dynamic import — the same
// pattern used for the s3-trigger handler test.

const ddbMock = mockClient(DynamoDBDocumentClient);

function baseEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/health',
    rawQueryString: '',
    headers: {},
    requestContext: {
      http: {
        method: 'GET',
        path: '/health',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
    } as APIGatewayProxyEventV2['requestContext'],
    isBase64Encoded: false,
    ...overrides,
  };
}

async function loadHandler(): Promise<typeof ApiHandlerModule> {
  vi.stubEnv('AWS_REGION', 'us-east-1');
  vi.stubEnv('JOBS_TABLE', 'test-jobs');
  vi.stubEnv('UPLOADS_BUCKET', 'test-uploads');
  vi.stubEnv('ORCHESTRATOR_ARN', 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test');
  return import('../../src/api/handler.js');
}

// streamifyResponse's declared type always takes (event, responseStream, context); the real
// handler ignores context, but every call site below must still pass one to satisfy the type.
const FAKE_CONTEXT = {} as Context;

function collect(stream: PassThrough): string[] {
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf-8')));
  return chunks;
}

// The exported handler's type comes from @types/aws-lambda's StreamifyHandler, which requires
// awslambda.HttpResponseStream (a Writable subclass with setContentType). Production code
// (src/api/*) only ever types responseStream as a plain Writable, so a real PassThrough is a
// faithful stand-in at runtime; this cast just satisfies the exported handler's declared type.
function asResponseStream(stream: PassThrough): Parameters<typeof ApiHandlerModule.handler>[1] {
  return stream as unknown as Parameters<typeof ApiHandlerModule.handler>[1];
}

describe('api handler (router)', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches GET /health to the health route', async () => {
    const { handler } = await loadHandler();
    const stream = new PassThrough();
    const chunks = collect(stream);

    await handler(baseEvent(), asResponseStream(stream), FAKE_CONTEXT);

    const body = JSON.parse(chunks.join('')) as { ok: boolean; service: string };
    expect(body).toMatchObject({ ok: true, service: 'api' });
  });

  it('extracts path params and dispatches GET /jobs/{jobId}', async () => {
    const jobId = '11111111-1111-4111-8111-111111111111';
    ddbMock.on(GetCommand).resolves({
      Item: {
        jobId,
        entity: 'JOB',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        docType: 'pdf',
        s3Key: `uploads/sync/${jobId}/report.pdf`,
        mode: 'sync',
        status: 'UPLOADED',
        events: [],
        ttl: 0,
      },
    });
    const { handler } = await loadHandler();
    const stream = new PassThrough();
    const chunks = collect(stream);

    await handler(
      baseEvent({
        rawPath: `/jobs/${jobId}`,
        requestContext: {
          http: {
            method: 'GET',
            path: `/jobs/${jobId}`,
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'vitest',
          },
        } as APIGatewayProxyEventV2['requestContext'],
      }),
      asResponseStream(stream),
      FAKE_CONTEXT,
    );

    const body = JSON.parse(chunks.join('')) as { jobId: string };
    expect(body.jobId).toBe(jobId);
  });

  it('writes a 404 error envelope for an unknown route', async () => {
    const { handler } = await loadHandler();
    const stream = new PassThrough();
    const chunks = collect(stream);

    await handler(
      baseEvent({
        rawPath: '/nope',
        requestContext: {
          http: {
            method: 'GET',
            path: '/nope',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'vitest',
          },
        } as APIGatewayProxyEventV2['requestContext'],
      }),
      asResponseStream(stream),
      FAKE_CONTEXT,
    );

    const body = JSON.parse(chunks.join('')) as { error: { code: string } };
    expect(body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('maps a thrown DocIntelError to its own error envelope for a matched route', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const { handler } = await loadHandler();
    const stream = new PassThrough();
    const chunks = collect(stream);
    const jobId = '22222222-2222-4222-8222-222222222222';

    await handler(
      baseEvent({
        rawPath: `/jobs/${jobId}`,
        requestContext: {
          http: {
            method: 'GET',
            path: `/jobs/${jobId}`,
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'vitest',
          },
        } as APIGatewayProxyEventV2['requestContext'],
      }),
      asResponseStream(stream),
      FAKE_CONTEXT,
    );

    const body = JSON.parse(chunks.join('')) as { error: { code: string } };
    expect(body.error.code).toBe('JOB_NOT_FOUND');
  });
});
