import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '../../src/lib/errors.js';
import { createJobStore } from '../../src/lib/jobs.js';
import { encodeCursor } from '../../src/lib/jobs-expressions.js';
import type { Job } from '../../src/lib/types.js';

const TABLE = 'docintel-jobs';
const EVENT = { source: 'aws' as const, agent: 'api', tool: 'create_job', message: 'Job created' };

function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    jobId: 'job-1',
    entity: 'JOB',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fileName: 'report.pdf',
    contentType: 'application/pdf',
    docType: 'pdf',
    s3Key: 'uploads/sync/job-1/report.pdf',
    mode: 'sync',
    status: 'PENDING_UPLOAD',
    events: [],
    ttl: 0,
    ...overrides,
  };
}

describe('createJobStore', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
  const store = createJobStore({ ddb, tableName: TABLE, ttlDays: 7 });

  beforeEach(() => {
    ddbMock.reset();
  });

  describe('get', () => {
    it('returns the job when found', async () => {
      ddbMock.on(GetCommand).resolves({ Item: jobFixture() });
      const job = await store.get('job-1');
      expect(job?.jobId).toBe('job-1');
    });

    it('returns undefined when not found', async () => {
      ddbMock.on(GetCommand).resolves({});
      expect(await store.get('missing')).toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates a PENDING_UPLOAD job with a create_job trace event, without idempotencyKey', async () => {
      ddbMock.on(PutCommand).resolves({});
      const job = await store.create({
        jobId: 'job-2',
        fileName: 'a.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docType: 'docx',
        mode: 'async',
        s3Key: 'uploads/async/job-2/a.docx',
      });

      expect(job.status).toBe('PENDING_UPLOAD');
      expect(job.events).toHaveLength(1);
      expect(job.events[0]?.tool).toBe('create_job');
      expect(job.ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));

      const puts = ddbMock.commandCalls(PutCommand);
      expect(puts).toHaveLength(1);
      expect(puts[0]?.args[0].input.ConditionExpression).toBe('attribute_not_exists(jobId)');
    });

    it('records an idempotency mapping when idempotencyKey is given and none exists yet', async () => {
      ddbMock.on(GetCommand).resolves({});
      ddbMock.on(PutCommand).resolves({});

      const job = await store.create({
        jobId: 'job-3',
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        docType: 'pdf',
        mode: 'sync',
        s3Key: 'uploads/sync/job-3/a.pdf',
        idempotencyKey: 'key-1',
      });

      expect(job.jobId).toBe('job-3');
      const puts = ddbMock.commandCalls(PutCommand);
      expect(puts).toHaveLength(2);
      expect(puts[0]?.args[0].input.Item).toMatchObject({
        jobId: 'IDEMP#key-1',
        entity: 'IDEMPOTENCY_KEY',
        targetJobId: 'job-3',
      });
      expect(puts[1]?.args[0].input.Item).toMatchObject({ jobId: 'job-3', entity: 'JOB' });
    });

    it('returns the existing job and skips creation when the idempotency key already maps to a job', async () => {
      ddbMock
        .on(PutCommand)
        .rejects(new ConditionalCheckFailedException({ message: 'conflict', $metadata: {} }));
      ddbMock
        .on(GetCommand, { Key: { jobId: 'IDEMP#key-1' } })
        .resolves({ Item: { targetJobId: 'job-3' } });
      ddbMock
        .on(GetCommand, { Key: { jobId: 'job-3' } })
        .resolves({ Item: jobFixture({ jobId: 'job-3' }) });

      const job = await store.create({
        jobId: 'job-4-ignored',
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        docType: 'pdf',
        mode: 'sync',
        s3Key: 'uploads/sync/job-4/a.pdf',
        idempotencyKey: 'key-1',
      });

      expect(job.jobId).toBe('job-3');
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    });

    it('throws ConflictError when the idempotency key reservation fails and no mapping is found', async () => {
      ddbMock
        .on(PutCommand)
        .rejects(new ConditionalCheckFailedException({ message: 'conflict', $metadata: {} }));
      ddbMock.on(GetCommand, { Key: { jobId: 'IDEMP#key-2' } }).resolves({});

      await expect(
        store.create({
          jobId: 'job-5',
          fileName: 'a.pdf',
          contentType: 'application/pdf',
          docType: 'pdf',
          mode: 'sync',
          s3Key: 'uploads/sync/job-5/a.pdf',
          idempotencyKey: 'key-2',
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('throws ConflictError when the job PutCommand itself races on jobId', async () => {
      ddbMock
        .on(PutCommand)
        .rejects(new ConditionalCheckFailedException({ message: 'conflict', $metadata: {} }));

      await expect(
        store.create({
          jobId: 'job-6',
          fileName: 'a.pdf',
          contentType: 'application/pdf',
          docType: 'pdf',
          mode: 'sync',
          s3Key: 'uploads/sync/job-6/a.pdf',
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('list', () => {
    it('queries the byCreatedAt GSI newest-first with the default limit', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [jobFixture()] });
      const result = await store.list({});
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();

      const query = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
      expect(query?.IndexName).toBe('byCreatedAt');
      expect(query?.ScanIndexForward).toBe(false);
      expect(query?.Limit).toBe(50);
    });

    it('clamps an oversized limit to the max', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      await store.list({ limit: 5000 });
      expect(ddbMock.commandCalls(QueryCommand)[0]?.args[0].input.Limit).toBe(200);
    });

    it('decodes an opaque cursor into ExclusiveStartKey and re-encodes LastEvaluatedKey', async () => {
      const lastKey = { jobId: 'job-9', entity: 'JOB', createdAt: '2026-01-02T00:00:00.000Z' };
      ddbMock.on(QueryCommand).resolves({ Items: [], LastEvaluatedKey: lastKey });
      const cursorIn = encodeCursor({
        jobId: 'job-8',
        entity: 'JOB',
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await store.list({ cursor: cursorIn });
      expect(result.nextCursor).toBe(encodeCursor(lastKey));
      expect(ddbMock.commandCalls(QueryCommand)[0]?.args[0].input.ExclusiveStartKey).toEqual({
        jobId: 'job-8',
        entity: 'JOB',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('updateStatus', () => {
    it('applies an allowed transition and includes extra fields in the SET clause', async () => {
      ddbMock.on(GetCommand).resolves({ Item: jobFixture({ status: 'PENDING_UPLOAD' }) });
      ddbMock.on(UpdateCommand).resolves({ Attributes: jobFixture({ status: 'UPLOADED' }) });

      const job = await store.updateStatus({
        jobId: 'job-1',
        status: 'UPLOADED',
        event: EVENT,
        s3Key: 'uploads/sync/job-1/report.pdf',
        sizeBytes: 1024,
      });

      expect(job.status).toBe('UPLOADED');
      const update = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
      expect(update?.ConditionExpression).toBe(
        'attribute_exists(jobId) AND #currentStatus = :expectedStatus',
      );
      expect(update?.ExpressionAttributeValues?.[':expectedStatus']).toBe('PENDING_UPLOAD');
      expect(update?.ExpressionAttributeValues?.[':s3Key']).toBe('uploads/sync/job-1/report.pdf');
      expect(update?.ExpressionAttributeValues?.[':sizeBytes']).toBe(1024);
    });

    it('throws ConflictError and never calls UpdateCommand for a disallowed transition', async () => {
      ddbMock.on(GetCommand).resolves({ Item: jobFixture({ status: 'COMPLETED' }) });
      await expect(
        store.updateStatus({ jobId: 'job-1', status: 'PROCESSING', event: EVENT }),
      ).rejects.toThrow(ConflictError);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('throws NotFoundError when the job does not exist', async () => {
      ddbMock.on(GetCommand).resolves({});
      await expect(
        store.updateStatus({ jobId: 'missing', status: 'UPLOADED', event: EVENT }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ConflictError when a concurrent writer changes the status first', async () => {
      ddbMock.on(GetCommand).resolves({ Item: jobFixture({ status: 'PENDING_UPLOAD' }) });
      ddbMock
        .on(UpdateCommand)
        .rejects(new ConditionalCheckFailedException({ message: 'conflict', $metadata: {} }));

      await expect(
        store.updateStatus({ jobId: 'job-1', status: 'UPLOADED', event: EVENT }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('appendEvent', () => {
    it('appends a trace event without changing status', async () => {
      ddbMock.on(GetCommand).resolves({ Item: jobFixture() });
      ddbMock.on(UpdateCommand).resolves({ Attributes: jobFixture() });
      await store.appendEvent('job-1', EVENT);
      const update = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
      expect(update?.ExpressionAttributeNames).not.toHaveProperty('#status');
    });

    it('throws NotFoundError when the job does not exist', async () => {
      ddbMock.on(GetCommand).resolves({});
      await expect(store.appendEvent('missing', EVENT)).rejects.toThrow(NotFoundError);
    });
  });

  describe('saveResult', () => {
    const result = {
      summary: 's',
      keyPoints: [],
      entities: [],
      topics: [],
      sentiment: 'neutral',
      language: 'en',
      pageCount: 1,
      wordCount: 1,
      extractionMethod: 'mammoth',
      model: 'm',
    };

    it('marks the job COMPLETED and stores the result, processor and resultS3Key', async () => {
      ddbMock.on(GetCommand).resolves({ Item: jobFixture({ status: 'PROCESSING' }) });
      ddbMock
        .on(UpdateCommand)
        .resolves({ Attributes: jobFixture({ status: 'COMPLETED', result }) });

      const job = await store.saveResult({
        jobId: 'job-1',
        result,
        event: EVENT,
        processor: 'aws-docx-agent',
        resultS3Key: 'results/job-1/result.json',
      });

      expect(job.status).toBe('COMPLETED');
      const update = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
      expect(update?.ExpressionAttributeValues?.[':result']).toBe(result);
      expect(update?.ExpressionAttributeValues?.[':processor']).toBe('aws-docx-agent');
      expect(update?.ExpressionAttributeValues?.[':resultS3Key']).toBe('results/job-1/result.json');
      expect(update?.ExpressionAttributeValues?.[':completedAt']).toBeDefined();
    });

    it('throws ConflictError when completing from a terminal FAILED state', async () => {
      ddbMock.on(GetCommand).resolves({ Item: jobFixture({ status: 'FAILED' }) });
      await expect(store.saveResult({ jobId: 'job-1', result, event: EVENT })).rejects.toThrow(
        ConflictError,
      );
    });
  });

  describe('fail', () => {
    it('marks the job FAILED with an error message', async () => {
      ddbMock.on(GetCommand).resolves({ Item: jobFixture({ status: 'PROCESSING' }) });
      ddbMock
        .on(UpdateCommand)
        .resolves({ Attributes: jobFixture({ status: 'FAILED', error: 'boom' }) });

      const job = await store.fail('job-1', 'boom', EVENT);
      expect(job.status).toBe('FAILED');
      const update = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
      expect(update?.ExpressionAttributeValues?.[':error']).toBe('boom');
    });

    it('throws NotFoundError when the job does not exist', async () => {
      ddbMock.on(GetCommand).resolves({});
      await expect(store.fail('missing', 'boom', EVENT)).rejects.toThrow(NotFoundError);
    });

    it('throws ConflictError and never calls UpdateCommand when the job is already COMPLETED', async () => {
      ddbMock.on(GetCommand).resolves({ Item: jobFixture({ status: 'COMPLETED' }) });
      await expect(store.fail('job-1', 'boom', EVENT)).rejects.toThrow(ConflictError);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });
  });
});
