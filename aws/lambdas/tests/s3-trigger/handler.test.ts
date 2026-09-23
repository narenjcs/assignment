import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { S3Event } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../src/lib/types.js';
import type * as S3TriggerHandlerModule from '../../src/s3-trigger/handler.js';

// The s3-trigger handler builds its DynamoDB/AgentCore clients from env vars at module
// import time (cold start, DEVELOPMENT.md §3), so each test stubs env + resets module state
// before a fresh dynamic import, per the pattern used for the api handler.

const ddbMock = mockClient(DynamoDBDocumentClient);
const bedrockMock = mockClient(BedrockAgentCoreClient);

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const KEY = `uploads/async/${JOB_ID}/report.pdf`;

function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    jobId: JOB_ID,
    entity: 'JOB',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fileName: 'report.pdf',
    contentType: 'application/pdf',
    docType: 'pdf',
    s3Key: KEY,
    mode: 'async',
    status: 'PENDING_UPLOAD',
    events: [],
    ttl: 0,
    ...overrides,
  };
}

function s3Event(key: string, size = 1024): S3Event {
  return {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'us-east-1',
        eventTime: '2026-01-01T00:00:00.000Z',
        eventName: 'ObjectCreated:Put',
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'test',
          bucket: {
            name: 'docintel-uploads',
            ownerIdentity: { principalId: 'test' },
            arn: 'arn:aws:s3:::docintel-uploads',
          },
          object: { key, size, eTag: 'etag', sequencer: 'seq' },
        },
      } as unknown as S3Event['Records'][number],
    ],
  };
}

async function loadHandler(): Promise<typeof S3TriggerHandlerModule> {
  vi.stubEnv('AWS_REGION', 'us-east-1');
  vi.stubEnv('JOBS_TABLE', 'test-jobs');
  vi.stubEnv('UPLOADS_BUCKET', 'test-uploads');
  vi.stubEnv('ORCHESTRATOR_ARN', 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test');
  return import('../../src/s3-trigger/handler.js');
}

describe('s3-trigger handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    bedrockMock.reset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sync mode: marks the job UPLOADED and never invokes the orchestrator', async () => {
    ddbMock.on(GetCommand).resolves({ Item: jobFixture({ mode: 'sync' }) });
    ddbMock
      .on(UpdateCommand)
      .resolves({ Attributes: jobFixture({ mode: 'sync', status: 'UPLOADED' }) });
    const { handler } = await loadHandler();

    await handler(s3Event(`uploads/sync/${JOB_ID}/report.pdf`));

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    expect(bedrockMock.commandCalls(InvokeAgentRuntimeCommand)).toHaveLength(0);
  });

  it('async mode: transitions PENDING_UPLOAD -> UPLOADED, then queues and invokes the orchestrator', async () => {
    // Get is called once by markUploaded itself, then once more inside each updateStatus()
    // call's own requireJob() check (jobs.ts), so the sequence is: PENDING_UPLOAD (markUploaded's
    // read), PENDING_UPLOAD (updateStatus->UPLOADED's requireJob), UPLOADED (updateStatus->QUEUED's
    // requireJob).
    ddbMock
      .on(GetCommand)
      .resolvesOnce({ Item: jobFixture() })
      .resolvesOnce({ Item: jobFixture() })
      .resolves({ Item: jobFixture({ status: 'UPLOADED' }) });
    ddbMock
      .on(UpdateCommand)
      .resolvesOnce({ Attributes: jobFixture({ status: 'UPLOADED' }) })
      .resolvesOnce({ Attributes: jobFixture({ status: 'QUEUED' }) });
    bedrockMock.on(InvokeAgentRuntimeCommand).resolves({
      contentType: 'application/json',
      statusCode: 200,
      response: { transformToString: () => Promise.resolve('') } as never,
    });
    const { handler } = await loadHandler();

    await handler(s3Event(KEY));

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
    expect(bedrockMock.commandCalls(InvokeAgentRuntimeCommand)).toHaveLength(1);
  });

  it('async mode: records a job failure (does not rethrow) when the orchestrator invoke fails', async () => {
    ddbMock
      .on(GetCommand)
      .resolvesOnce({ Item: jobFixture() })
      .resolvesOnce({ Item: jobFixture() })
      .resolves({ Item: jobFixture({ status: 'UPLOADED' }) });
    ddbMock
      .on(UpdateCommand)
      .resolvesOnce({ Attributes: jobFixture({ status: 'UPLOADED' }) })
      .resolvesOnce({ Attributes: jobFixture({ status: 'QUEUED' }) })
      .resolvesOnce({ Attributes: jobFixture({ status: 'FAILED' }) });
    bedrockMock.on(InvokeAgentRuntimeCommand).rejects(new Error('runtime unavailable'));
    const { handler } = await loadHandler();

    await expect(handler(s3Event(KEY))).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(3);
  });

  it('async mode: records a job failure when the orchestrator returns a non-2xx status, even with a valid JSON body', async () => {
    ddbMock
      .on(GetCommand)
      .resolvesOnce({ Item: jobFixture() })
      .resolvesOnce({ Item: jobFixture() })
      .resolves({ Item: jobFixture({ status: 'UPLOADED' }) });
    ddbMock
      .on(UpdateCommand)
      .resolvesOnce({ Attributes: jobFixture({ status: 'UPLOADED' }) })
      .resolvesOnce({ Attributes: jobFixture({ status: 'QUEUED' }) })
      .resolvesOnce({ Attributes: jobFixture({ status: 'FAILED' }) });
    bedrockMock.on(InvokeAgentRuntimeCommand).resolves({
      contentType: 'application/json',
      statusCode: 500,
      response: { transformToString: () => Promise.resolve('{"error":"boom"}') } as never,
    });
    const { handler } = await loadHandler();

    await expect(handler(s3Event(KEY))).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(3);
  });

  it('async mode: does not fail the job when the orchestrator returns a 200 with a non-JSON ack body', async () => {
    ddbMock
      .on(GetCommand)
      .resolvesOnce({ Item: jobFixture() })
      .resolvesOnce({ Item: jobFixture() })
      .resolves({ Item: jobFixture({ status: 'UPLOADED' }) });
    ddbMock
      .on(UpdateCommand)
      .resolvesOnce({ Attributes: jobFixture({ status: 'UPLOADED' }) })
      .resolvesOnce({ Attributes: jobFixture({ status: 'QUEUED' }) });
    bedrockMock.on(InvokeAgentRuntimeCommand).resolves({
      contentType: 'text/plain',
      statusCode: 200,
      response: { transformToString: () => Promise.resolve('not json') } as never,
    });
    const { handler } = await loadHandler();

    await expect(handler(s3Event(KEY))).resolves.toBeUndefined();
    // Only the two happy-path transitions (UPLOADED, QUEUED) — no third FAILED update.
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
  });

  it('is idempotent: a redelivered event for an already-UPLOADED job only appends an event', async () => {
    ddbMock.on(GetCommand).resolves({ Item: jobFixture({ status: 'UPLOADED' }) });
    ddbMock.on(UpdateCommand).resolves({ Attributes: jobFixture({ status: 'UPLOADED' }) });
    const { handler } = await loadHandler();

    await handler(s3Event(KEY));

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.args[0].input.ExpressionAttributeValues).not.toHaveProperty(':status');
    expect(bedrockMock.commandCalls(InvokeAgentRuntimeCommand)).toHaveLength(0);
  });

  it('is idempotent: a redelivered event for an already-QUEUED async job does not re-invoke the orchestrator', async () => {
    ddbMock.on(GetCommand).resolves({ Item: jobFixture({ status: 'QUEUED' }) });
    ddbMock.on(UpdateCommand).resolves({ Attributes: jobFixture({ status: 'QUEUED' }) });
    const { handler } = await loadHandler();

    await handler(s3Event(KEY));

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    expect(bedrockMock.commandCalls(InvokeAgentRuntimeCommand)).toHaveLength(0);
  });

  it('ignores non-upload keys', async () => {
    const { handler } = await loadHandler();
    await handler(s3Event('results/job-1/result.json'));
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('logs and skips a malformed upload key instead of throwing', async () => {
    const { handler } = await loadHandler();
    await expect(handler(s3Event('uploads/sync/not-a-uuid/file.pdf'))).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('logs and skips when the job cannot be found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const { handler } = await loadHandler();
    await expect(handler(s3Event(KEY))).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('URL-decodes the S3 object key (+ becomes space)', async () => {
    ddbMock
      .on(GetCommand)
      .resolves({ Item: jobFixture({ mode: 'sync', fileName: 'my report.pdf' }) });
    ddbMock
      .on(UpdateCommand)
      .resolves({ Attributes: jobFixture({ mode: 'sync', status: 'UPLOADED' }) });
    const { handler } = await loadHandler();

    await handler(s3Event(`uploads/sync/${JOB_ID}/my+report.pdf`));

    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(JSON.stringify(call?.args[0].input.ExpressionAttributeValues)).toContain(
      'my report.pdf',
    );
  });
});
