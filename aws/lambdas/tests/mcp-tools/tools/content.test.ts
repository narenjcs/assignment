import { describe, expect, it, vi } from 'vitest';
import { getDocumentContent, MAX_CONTENT_BYTES } from '../../../src/mcp-tools/tools/content.js';
import type { ContentToolDeps } from '../../../src/mcp-tools/tools/content.js';
import { ValidationError } from '../../../src/lib/errors.js';
import type { Job } from '../../../src/lib/types.js';
import type { JobStore } from '../../../src/lib/jobs.js';
import type { S3Helper } from '../../../src/lib/s3.js';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    jobId: JOB_ID,
    entity: 'JOB',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fileName: 'report.pdf',
    contentType: 'application/pdf',
    docType: 'pdf',
    s3Key: `uploads/sync/${JOB_ID}/report.pdf`,
    mode: 'sync',
    status: 'PROCESSING',
    events: [],
    ttl: 0,
    ...overrides,
  };
}

function fakeDeps(job: Job | undefined, bytes: Uint8Array): ContentToolDeps {
  return {
    jobStore: { get: vi.fn(() => Promise.resolve(job)) } as unknown as JobStore,
    s3Helper: { getObjectBytes: vi.fn(() => Promise.resolve(bytes)) } as unknown as S3Helper,
  };
}

describe('getDocumentContent', () => {
  it('returns the object bytes base64-encoded with file metadata', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 hello');
    const deps = fakeDeps(jobFixture(), bytes);

    const result = await getDocumentContent({ job_id: JOB_ID }, deps);

    expect(deps.s3Helper.getObjectBytes).toHaveBeenCalledWith(`uploads/sync/${JOB_ID}/report.pdf`);
    expect(result).toEqual({
      contentBase64: Buffer.from(bytes).toString('base64'),
      sizeBytes: bytes.byteLength,
      fileName: 'report.pdf',
      contentType: 'application/pdf',
    });
  });

  it('throws JOB_NOT_FOUND for an unknown job', async () => {
    const deps = fakeDeps(undefined, new Uint8Array());
    await expect(getDocumentContent({ job_id: JOB_ID }, deps)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('refuses before downloading when the recorded size is over the cap', async () => {
    const deps = fakeDeps(jobFixture({ sizeBytes: MAX_CONTENT_BYTES + 1 }), new Uint8Array());
    await expect(getDocumentContent({ job_id: JOB_ID }, deps)).rejects.toThrow(/capped/);
    expect(deps.s3Helper.getObjectBytes).not.toHaveBeenCalled();
  });

  it('refuses when the downloaded object is over the cap', async () => {
    const deps = fakeDeps(jobFixture(), new Uint8Array(MAX_CONTENT_BYTES + 1));
    await expect(getDocumentContent({ job_id: JOB_ID }, deps)).rejects.toThrow(/capped/);
  });
});
