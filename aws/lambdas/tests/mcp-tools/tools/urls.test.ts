import { describe, expect, it, vi } from 'vitest';
import { getDownloadUrl } from '../../../src/mcp-tools/tools/urls.js';
import type { UrlsToolDeps } from '../../../src/mcp-tools/tools/urls.js';
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
    status: 'COMPLETED',
    events: [],
    ttl: 0,
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<UrlsToolDeps> = {}): UrlsToolDeps {
  return {
    jobStore: { get: vi.fn(() => Promise.resolve(jobFixture())) } as unknown as JobStore,
    s3Helper: {
      presignDownload: vi.fn(() => Promise.resolve('https://example.com/signed')),
    } as unknown as S3Helper,
    ...overrides,
  };
}

describe('getDownloadUrl', () => {
  it('presigns with the default TTL and returns file metadata', async () => {
    const presignDownload = vi.fn(() => Promise.resolve('https://example.com/signed'));
    const deps = fakeDeps({ s3Helper: { presignDownload } as unknown as S3Helper });

    const result = (await getDownloadUrl({ job_id: JOB_ID }, deps)) as {
      downloadUrl: string;
      expiresIn: number;
      fileName: string;
      contentType: string;
    };

    expect(presignDownload).toHaveBeenCalledWith(`uploads/sync/${JOB_ID}/report.pdf`, 900);
    expect(result).toEqual({
      downloadUrl: 'https://example.com/signed',
      expiresIn: 900,
      fileName: 'report.pdf',
      contentType: 'application/pdf',
    });
  });

  it('honors an explicit expires_seconds override', async () => {
    const presignDownload = vi.fn(() => Promise.resolve('https://example.com/signed'));
    const deps = fakeDeps({ s3Helper: { presignDownload } as unknown as S3Helper });

    const result = (await getDownloadUrl({ job_id: JOB_ID, expires_seconds: 60 }, deps)) as {
      expiresIn: number;
    };

    expect(presignDownload).toHaveBeenCalledWith(`uploads/sync/${JOB_ID}/report.pdf`, 60);
    expect(result.expiresIn).toBe(60);
  });

  it('throws ValidationError JOB_NOT_FOUND when the job does not exist', async () => {
    const deps = fakeDeps({
      jobStore: { get: vi.fn(() => Promise.resolve(undefined)) } as unknown as JobStore,
    });
    await expect(getDownloadUrl({ job_id: JOB_ID }, deps)).rejects.toThrow(ValidationError);
  });
});
