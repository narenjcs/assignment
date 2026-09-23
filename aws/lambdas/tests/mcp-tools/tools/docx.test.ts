import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/lib/errors.js';
import type { JobStore } from '../../../src/lib/jobs.js';
import type { S3Helper } from '../../../src/lib/s3.js';
import type { Job } from '../../../src/lib/types.js';

const extractRawText = vi.fn<(input: { buffer: Buffer }) => Promise<{ value: string }>>();

vi.mock('mammoth', () => ({
  default: { extractRawText: (input: { buffer: Buffer }) => extractRawText(input) },
}));

// Imported after the mock so the module under test picks up the mocked `mammoth` default export.
const { extractDocxText } = await import('../../../src/mcp-tools/tools/docx.js');
type DocxToolDeps = Parameters<typeof extractDocxText>[1];

const JOB_ID = '11111111-1111-4111-8111-111111111111';

function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    jobId: JOB_ID,
    entity: 'JOB',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fileName: 'report.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    docType: 'docx',
    s3Key: `uploads/sync/${JOB_ID}/report.docx`,
    mode: 'sync',
    status: 'UPLOADED',
    events: [],
    ttl: 0,
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<DocxToolDeps> = {}): DocxToolDeps {
  return {
    jobStore: { get: vi.fn(() => Promise.resolve(jobFixture())) } as unknown as JobStore,
    s3Helper: {
      getObjectBytes: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
    } as unknown as S3Helper,
    ...overrides,
  };
}

describe('extractDocxText', () => {
  beforeEach(() => {
    extractRawText.mockReset();
  });

  it('extracts text, word count and mammoth as the extraction method', async () => {
    extractRawText.mockResolvedValue({ value: 'one two three four five' });
    const deps = fakeDeps();

    const result = (await extractDocxText({ job_id: JOB_ID }, deps)) as {
      text: string;
      truncated: boolean;
      wordCount: number;
      pageCount: number;
      extractionMethod: string;
    };

    expect(result).toEqual({
      text: 'one two three four five',
      truncated: false,
      wordCount: 5,
      pageCount: 1,
      extractionMethod: 'mammoth',
    });
  });

  it('estimates page count from word count (450 words/page) when there are no form feeds', async () => {
    extractRawText.mockResolvedValue({ value: Array(901).fill('word').join(' ') });
    const deps = fakeDeps();

    const result = (await extractDocxText({ job_id: JOB_ID }, deps)) as {
      pageCount: number;
      wordCount: number;
    };

    expect(result.wordCount).toBe(901);
    expect(result.pageCount).toBe(3);
  });

  it('prefers form-feed page breaks over the word-count estimate when present', async () => {
    extractRawText.mockResolvedValue({ value: 'page one\fpage two\fpage three' });
    const deps = fakeDeps();

    const result = (await extractDocxText({ job_id: JOB_ID }, deps)) as { pageCount: number };

    expect(result.pageCount).toBe(3);
  });

  it('truncates text past 20,000 characters and sets truncated: true', async () => {
    extractRawText.mockResolvedValue({ value: 'x'.repeat(20_500) });
    const deps = fakeDeps();

    const result = (await extractDocxText({ job_id: JOB_ID }, deps)) as {
      text: string;
      truncated: boolean;
    };

    expect(result.text).toHaveLength(20_000);
    expect(result.truncated).toBe(true);
  });

  it('throws ValidationError UNSUPPORTED_DOC_TYPE for a non-docx job', async () => {
    const deps = fakeDeps({
      jobStore: {
        get: vi.fn(() => Promise.resolve(jobFixture({ docType: 'pdf' }))),
      } as unknown as JobStore,
    });
    await expect(extractDocxText({ job_id: JOB_ID }, deps)).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError JOB_NOT_FOUND when the job does not exist', async () => {
    const deps = fakeDeps({
      jobStore: { get: vi.fn(() => Promise.resolve(undefined)) } as unknown as JobStore,
    });
    await expect(extractDocxText({ job_id: JOB_ID }, deps)).rejects.toThrow(ValidationError);
  });
});
