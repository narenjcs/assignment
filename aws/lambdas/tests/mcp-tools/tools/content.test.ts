import { describe, expect, it, vi } from 'vitest';
import {
  getDocumentContent,
  getDocumentContentArgsSchema,
  MAX_CHUNK_BYTES,
} from '../../../src/mcp-tools/tools/content.js';
import type { ContentToolDeps } from '../../../src/mcp-tools/tools/content.js';
import { ValidationError } from '../../../src/lib/errors.js';
import type { Job } from '../../../src/lib/types.js';
import type { JobStore } from '../../../src/lib/jobs.js';
import type { ObjectRange, S3Helper } from '../../../src/lib/s3.js';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

function jobFixture(): Job {
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
  };
}

/** Serves ranges of `object` the way S3 does: clamped at the end, total size reported. */
function fakeDeps(job: Job | undefined, object: Uint8Array): ContentToolDeps {
  const getObjectRange = vi.fn(
    (_key: string, offset: number, length: number): Promise<ObjectRange> =>
      Promise.resolve({
        bytes: object.slice(offset, offset + length),
        totalBytes: object.byteLength,
      }),
  );
  return {
    jobStore: { get: vi.fn(() => Promise.resolve(job)) } as unknown as JobStore,
    s3Helper: { getObjectRange } as unknown as S3Helper,
  };
}

interface Chunk {
  contentBase64: string;
  offset: number;
  chunkBytes: number;
  sizeBytes: number;
  done: boolean;
}

describe('getDocumentContent', () => {
  it('returns a small document in one chunk marked done', async () => {
    const object = new TextEncoder().encode('%PDF-1.7 hello');
    const deps = fakeDeps(jobFixture(), object);

    const result = (await getDocumentContent({ job_id: JOB_ID }, deps)) as Chunk;

    expect(deps.s3Helper.getObjectRange).toHaveBeenCalledWith(
      `uploads/sync/${JOB_ID}/report.pdf`,
      0,
      MAX_CHUNK_BYTES,
    );
    expect(result).toMatchObject({
      contentBase64: Buffer.from(object).toString('base64'),
      offset: 0,
      chunkBytes: object.byteLength,
      sizeBytes: object.byteLength,
      done: true,
      fileName: 'report.pdf',
      contentType: 'application/pdf',
    });
  });

  it('reassembles a multi-chunk document exactly when looped until done', async () => {
    const object = Uint8Array.from({ length: 25 }, (_, i) => i);
    const deps = fakeDeps(jobFixture(), object);
    const parts: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const chunk = (await getDocumentContent(
        { job_id: JOB_ID, offset, length: 10 },
        deps,
      )) as Chunk;
      parts.push(Buffer.from(chunk.contentBase64, 'base64'));
      offset += chunk.chunkBytes;
      if (chunk.done) break;
    }
    expect(parts).toHaveLength(3);
    expect(Buffer.concat(parts)).toEqual(Buffer.from(object));
  });

  it('throws JOB_NOT_FOUND for an unknown job', async () => {
    const deps = fakeDeps(undefined, new Uint8Array());
    await expect(getDocumentContent({ job_id: JOB_ID }, deps)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a chunk length over the cap', () => {
    expect(() =>
      getDocumentContentArgsSchema.parse({ job_id: JOB_ID, length: MAX_CHUNK_BYTES + 1 }),
    ).toThrow();
  });
});
