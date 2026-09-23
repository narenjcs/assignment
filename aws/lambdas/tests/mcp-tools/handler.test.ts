import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as McpToolsHandlerModule from '../../src/mcp-tools/handler.js';

// mcp-tools/handler.ts builds its DynamoDB/S3 clients from env vars at module import time
// (cold start, DEVELOPMENT.md §3) — same dynamic-import + vi.stubEnv pattern as the api and
// s3-trigger handler tests.

const ddbMock = mockClient(DynamoDBDocumentClient);

function contextWithTool(toolName: string): Context {
  return {
    clientContext: { custom: { bedrockAgentCoreToolName: `docintel-tools___${toolName}` } },
  } as unknown as Context;
}

async function loadHandler(): Promise<typeof McpToolsHandlerModule> {
  vi.stubEnv('AWS_REGION', 'us-east-1');
  vi.stubEnv('JOBS_TABLE', 'test-jobs');
  vi.stubEnv('UPLOADS_BUCKET', 'test-uploads');
  return import('../../src/mcp-tools/handler.js');
}

describe('mcp-tools handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves the tool name from clientContext.custom, stripping the target prefix', async () => {
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

    const result = await handler({ job_id: jobId }, contextWithTool('get_job'));

    expect(result.ok).toBe(true);
    expect((result.data as { jobId: string }).jobId).toBe(jobId);
  });

  it('returns ok:false with UNKNOWN_TOOL for a tool name not in the registry', async () => {
    const { handler } = await loadHandler();

    const result = await handler({}, contextWithTool('not_a_real_tool'));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN_TOOL',
        message: expect.stringContaining('not_a_real_tool') as string,
      },
    });
  });

  it('returns ok:false with VALIDATION_ERROR when zod parsing fails', async () => {
    const { handler } = await loadHandler();

    const result = await handler({}, contextWithTool('get_job'));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns ok:false with the tool-thrown DocIntelError code (e.g. JOB_NOT_FOUND)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const { handler } = await loadHandler();

    const result = await handler(
      { job_id: '22222222-2222-4222-8222-222222222222' },
      contextWithTool('get_job'),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'JOB_NOT_FOUND', message: expect.stringContaining('not found') as string },
    });
  });

  it('maps an unexpected generic error to INTERNAL_ERROR and never throws', async () => {
    ddbMock.on(GetCommand).rejects(new Error('dynamodb unavailable'));
    const { handler } = await loadHandler();

    const result = await handler(
      { job_id: '33333333-3333-4333-8333-333333333333' },
      contextWithTool('get_job'),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });

  it('throws a plain error (missing clientContext) and the handler still resolves rather than rejecting', async () => {
    const { handler } = await loadHandler();

    await expect(handler({}, {} as Context)).resolves.toMatchObject({ ok: false });
  });
});
