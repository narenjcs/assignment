import { describe, expect, it } from 'vitest';
import { routeUploads } from '../../../src/api/routes/uploads.js';
import { ValidationError } from '../../../src/lib/errors.js';
import type { Job } from '../../../src/lib/types.js';
import { buildTestContext, fakeJobStore, fakeS3Helper, writtenText } from './helpers.js';

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

describe('routeUploads', () => {
  it('creates the job, presigns an upload URL and returns 201 with the expected shape', async () => {
    const job = jobFixture();
    const jobStore = fakeJobStore({ create: () => Promise.resolve(job) });
    const s3Helper = fakeS3Helper({
      presignUpload: () => Promise.resolve('https://s3.example.com/put-url'),
    });
    const ctx = buildTestContext({
      method: 'POST',
      path: '/uploads',
      body: JSON.stringify({
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        mode: 'sync',
      }),
      deps: { ...buildTestContext().deps, jobStore, s3Helper },
    });

    await routeUploads(ctx);

    const body = JSON.parse(writtenText(ctx)) as {
      jobId: string;
      uploadUrl: string;
      s3Key: string;
      expiresIn: number;
    };
    expect(body).toEqual({
      jobId: 'job-1',
      uploadUrl: 'https://s3.example.com/put-url',
      s3Key: 'uploads/sync/job-1/report.pdf',
      expiresIn: 900,
    });
  });

  it('passes idempotencyKey through to jobStore.create only when provided', async () => {
    let receivedIdempotencyKey: string | undefined;
    const jobStore = fakeJobStore({
      create: (input) => {
        receivedIdempotencyKey = input.idempotencyKey;
        return Promise.resolve(jobFixture());
      },
    });
    const s3Helper = fakeS3Helper({
      presignUpload: () => Promise.resolve('https://s3.example.com/put-url'),
    });
    const ctx = buildTestContext({
      method: 'POST',
      path: '/uploads',
      body: JSON.stringify({
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        mode: 'sync',
        idempotencyKey: 'my-key',
      }),
      deps: { ...buildTestContext().deps, jobStore, s3Helper },
    });

    await routeUploads(ctx);
    expect(receivedIdempotencyKey).toBe('my-key');
  });

  it('throws ValidationError (400) for a missing required field', async () => {
    const ctx = buildTestContext({
      method: 'POST',
      path: '/uploads',
      body: JSON.stringify({ contentType: 'application/pdf', mode: 'sync' }),
    });
    await expect(routeUploads(ctx)).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError (400) for an unsupported content type', async () => {
    const ctx = buildTestContext({
      method: 'POST',
      path: '/uploads',
      body: JSON.stringify({ fileName: 'a.txt', contentType: 'text/plain', mode: 'sync' }),
    });
    await expect(routeUploads(ctx)).rejects.toThrow(ValidationError);
  });
});
