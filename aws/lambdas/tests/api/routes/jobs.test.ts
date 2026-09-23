import { describe, expect, it } from 'vitest';
import { routeJobGet, routeJobProcess, routeJobsList } from '../../../src/api/routes/jobs.js';
import { ConflictError, NotFoundError } from '../../../src/lib/errors.js';
import type { AgentCoreInvoker, InvokeResult } from '../../../src/lib/agentcore.js';
import type { Job } from '../../../src/lib/types.js';
import {
  buildTestContext,
  fakeAgentCore,
  fakeJobStore,
  fakeS3Helper,
  writtenText,
} from './helpers.js';

function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    jobId: '11111111-1111-4111-8111-111111111111',
    entity: 'JOB',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fileName: 'report.pdf',
    contentType: 'application/pdf',
    docType: 'pdf',
    s3Key: 'uploads/sync/11111111-1111-4111-8111-111111111111/report.pdf',
    mode: 'sync',
    status: 'UPLOADED',
    events: [],
    ttl: 0,
    ...overrides,
  };
}

describe('routeJobsList', () => {
  it('passes limit and cursor through only when present, and writes the result as-is', async () => {
    let receivedInput: unknown;
    const jobStore = fakeJobStore({
      list: (input) => {
        receivedInput = input;
        return Promise.resolve({ items: [jobFixture()] });
      },
    });
    const ctx = buildTestContext({
      method: 'GET',
      path: '/jobs',
      query: { limit: '10', cursor: 'abc' },
      deps: { ...buildTestContext().deps, jobStore },
    });

    await routeJobsList(ctx);

    expect(receivedInput).toEqual({ limit: 10, cursor: 'abc' });
    const body = JSON.parse(writtenText(ctx)) as { items: Job[] };
    expect(body.items).toHaveLength(1);
  });

  it('omits limit/cursor from the list() call when neither is given', async () => {
    let receivedInput: unknown;
    const jobStore = fakeJobStore({
      list: (input) => {
        receivedInput = input;
        return Promise.resolve({ items: [] });
      },
    });
    const ctx = buildTestContext({
      method: 'GET',
      path: '/jobs',
      deps: { ...buildTestContext().deps, jobStore },
    });
    await routeJobsList(ctx);
    expect(receivedInput).toEqual({});
  });
});

describe('routeJobGet', () => {
  it('returns the full job document', async () => {
    const job = jobFixture();
    const jobStore = fakeJobStore({ get: () => Promise.resolve(job) });
    const ctx = buildTestContext({ deps: { ...buildTestContext().deps, jobStore } });

    await routeJobGet(ctx, { jobId: job.jobId });
    expect(JSON.parse(writtenText(ctx))).toEqual(job);
  });

  it('throws NotFoundError (404) when the job does not exist', async () => {
    const jobStore = fakeJobStore({ get: () => Promise.resolve(undefined) });
    const ctx = buildTestContext({ deps: { ...buildTestContext().deps, jobStore } });
    await expect(
      routeJobGet(ctx, { jobId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('routeJobProcess', () => {
  it('throws ConflictError (409) when the job is not in a processable status', async () => {
    const jobStore = fakeJobStore({
      get: () => Promise.resolve(jobFixture({ status: 'COMPLETED' })),
    });
    const ctx = buildTestContext({ deps: { ...buildTestContext().deps, jobStore } });
    await expect(
      routeJobProcess(ctx, { jobId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError (409) for a QUEUED job — async processing is already in flight', async () => {
    const jobStore = fakeJobStore({
      get: () => Promise.resolve(jobFixture({ status: 'QUEUED' })),
    });
    const ctx = buildTestContext({ deps: { ...buildTestContext().deps, jobStore } });
    await expect(
      routeJobProcess(ctx, { jobId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError (409) for a PROCESSING job — refuses a second concurrent run', async () => {
    const jobStore = fakeJobStore({
      get: () => Promise.resolve(jobFixture({ status: 'PROCESSING' })),
    });
    const ctx = buildTestContext({ deps: { ...buildTestContext().deps, jobStore } });
    await expect(
      routeJobProcess(ctx, { jobId: '11111111-1111-4111-8111-111111111111' }),
    ).rejects.toThrow(ConflictError);
  });

  it('opens an SSE stream and proxies the orchestrator response for a processable job', async () => {
    const job = jobFixture({ status: 'UPLOADED' });
    const jobStore = fakeJobStore({ get: () => Promise.resolve(job) });
    const invoke: AgentCoreInvoker['invoke'] = (): Promise<InvokeResult> =>
      Promise.resolve({ contentType: 'text/event-stream', statusCode: 200, response: undefined });
    const agentCore = fakeAgentCore({ invoke });
    const ctx = buildTestContext({ deps: { ...buildTestContext().deps, jobStore, agentCore } });

    await routeJobProcess(ctx, { jobId: job.jobId });

    expect(writtenText(ctx)).toContain('"type":"done"');
  });

  it('HEAD-checks S3 for a PENDING_UPLOAD job, transitions to UPLOADED and proceeds when the object exists', async () => {
    const job = jobFixture({ status: 'PENDING_UPLOAD' });
    const updated = { ...job, status: 'UPLOADED' as const, sizeBytes: 1234 };
    let updateStatusInput: unknown;
    const jobStore = fakeJobStore({
      get: () => Promise.resolve(job),
      updateStatus: (input) => {
        updateStatusInput = input;
        return Promise.resolve(updated);
      },
    });
    const headObject = (): Promise<{ sizeBytes: number }> => Promise.resolve({ sizeBytes: 1234 });
    const s3Helper = fakeS3Helper({ headObject });
    const invoke: AgentCoreInvoker['invoke'] = (): Promise<InvokeResult> =>
      Promise.resolve({ contentType: 'text/event-stream', statusCode: 200, response: undefined });
    const agentCore = fakeAgentCore({ invoke });
    const ctx = buildTestContext({
      deps: { ...buildTestContext().deps, jobStore, s3Helper, agentCore },
    });

    await routeJobProcess(ctx, { jobId: job.jobId });

    expect(updateStatusInput).toMatchObject({
      jobId: job.jobId,
      status: 'UPLOADED',
      sizeBytes: 1234,
    });
    expect(writtenText(ctx)).toContain('"type":"done"');
  });

  it('returns 409 JOB_NOT_PROCESSABLE for a PENDING_UPLOAD job when the S3 object does not exist yet', async () => {
    const job = jobFixture({ status: 'PENDING_UPLOAD' });
    const jobStore = fakeJobStore({ get: () => Promise.resolve(job) });
    const s3Helper = fakeS3Helper({ headObject: () => Promise.resolve(undefined) });
    const ctx = buildTestContext({ deps: { ...buildTestContext().deps, jobStore, s3Helper } });

    await expect(routeJobProcess(ctx, { jobId: job.jobId })).rejects.toThrow(ConflictError);
  });

  it('recovers from a race with the S3 trigger: re-reads and proceeds when updateStatus conflicts', async () => {
    const pending = jobFixture({ status: 'PENDING_UPLOAD' });
    const uploaded = jobFixture({ status: 'UPLOADED' });
    let getCalls = 0;
    const jobStore = fakeJobStore({
      get: () => {
        getCalls += 1;
        return Promise.resolve(getCalls === 1 ? pending : uploaded);
      },
      updateStatus: () =>
        Promise.reject(new ConflictError('JOB_STATUS_CHANGED', 'raced with the S3 trigger')),
    });
    const headObject = (): Promise<{ sizeBytes: number }> => Promise.resolve({ sizeBytes: 1234 });
    const s3Helper = fakeS3Helper({ headObject });
    const invoke: AgentCoreInvoker['invoke'] = (): Promise<InvokeResult> =>
      Promise.resolve({ contentType: 'text/event-stream', statusCode: 200, response: undefined });
    const agentCore = fakeAgentCore({ invoke });
    const ctx = buildTestContext({
      deps: { ...buildTestContext().deps, jobStore, s3Helper, agentCore },
    });

    await routeJobProcess(ctx, { jobId: pending.jobId });

    expect(writtenText(ctx)).toContain('"type":"done"');
  });
});
