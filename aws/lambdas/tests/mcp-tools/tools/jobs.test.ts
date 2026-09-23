import { describe, expect, it, vi } from 'vitest';
import {
  appendJobEvent,
  getJob,
  listJobs,
  saveJobResult,
  updateJobStatus,
} from '../../../src/mcp-tools/tools/jobs.js';
import type { JobsToolDeps } from '../../../src/mcp-tools/tools/jobs.js';
import { ValidationError } from '../../../src/lib/errors.js';
import type { Job, JobResult } from '../../../src/lib/types.js';

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
    status: 'UPLOADED',
    events: [],
    ttl: 0,
    ...overrides,
  };
}

const resultFixture: JobResult = {
  summary: 'A short document.',
  keyPoints: ['point one'],
  entities: [{ name: 'Acme', type: 'ORG' }],
  topics: ['finance'],
  sentiment: 'neutral',
  language: 'en',
  pageCount: 1,
  wordCount: 42,
  extractionMethod: 'mammoth',
  model: 'test-model',
};

function fakeDeps(overrides: Partial<JobsToolDeps> = {}): JobsToolDeps {
  return {
    jobStore: {
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      updateStatus: vi.fn(),
      appendEvent: vi.fn(),
      saveResult: vi.fn(),
      fail: vi.fn(),
    },
    s3Helper: {
      presignUpload: vi.fn(),
      presignDownload: vi.fn(),
      getObjectBytes: vi.fn(),
      putJson: vi.fn(),
      headObject: vi.fn(),
    },
    ...overrides,
  };
}

describe('getJob', () => {
  it('returns the job when found', async () => {
    const job = jobFixture();
    const deps = fakeDeps({
      jobStore: { ...fakeDeps().jobStore, get: () => Promise.resolve(job) },
    });
    await expect(getJob({ job_id: JOB_ID }, deps)).resolves.toEqual(job);
  });

  it('throws ValidationError when the job does not exist', async () => {
    const deps = fakeDeps({
      jobStore: { ...fakeDeps().jobStore, get: () => Promise.resolve(undefined) },
    });
    await expect(getJob({ job_id: JOB_ID }, deps)).rejects.toThrow(ValidationError);
  });
});

describe('listJobs', () => {
  it('passes limit through when given', async () => {
    let received: unknown;
    const deps = fakeDeps({
      jobStore: {
        ...fakeDeps().jobStore,
        list: (input) => ((received = input), Promise.resolve({ items: [] })),
      },
    });
    await listJobs({ limit: 5 }, deps);
    expect(received).toEqual({ limit: 5 });
  });

  it('omits limit when not given', async () => {
    let received: unknown;
    const deps = fakeDeps({
      jobStore: {
        ...fakeDeps().jobStore,
        list: (input) => ((received = input), Promise.resolve({ items: [] })),
      },
    });
    await listJobs({}, deps);
    expect(received).toEqual({});
  });
});

describe('updateJobStatus', () => {
  it('defaults agent/tool/message and forwards processor when given', async () => {
    let received: unknown;
    const deps = fakeDeps({
      jobStore: {
        ...fakeDeps().jobStore,
        updateStatus: (input) => ((received = input), Promise.resolve(jobFixture())),
      },
    });
    await updateJobStatus(
      { job_id: JOB_ID, status: 'PROCESSING', processor: 'aws-docx-agent' },
      deps,
    );
    expect(received).toMatchObject({
      jobId: JOB_ID,
      status: 'PROCESSING',
      processor: 'aws-docx-agent',
      event: { source: 'orchestrator', agent: 'orchestrator', tool: 'update_job_status' },
    });
  });
});

describe('appendJobEvent', () => {
  it('forwards the event with required source and message', async () => {
    let received: unknown;
    const deps = fakeDeps({
      jobStore: {
        ...fakeDeps().jobStore,
        appendEvent: (jobId, event) => (
          (received = { jobId, event }),
          Promise.resolve(jobFixture())
        ),
      },
    });
    await appendJobEvent({ job_id: JOB_ID, source: 'databricks', message: 'OCR complete' }, deps);
    expect(received).toMatchObject({
      jobId: JOB_ID,
      event: {
        source: 'databricks',
        agent: 'orchestrator',
        tool: 'append_job_event',
        message: 'OCR complete',
      },
    });
  });
});

describe('saveJobResult', () => {
  it('writes the parsed result to S3 at results/{jobId}/result.json and returns the job with resultS3Key', async () => {
    const putJson = vi.fn(() => Promise.resolve(undefined));
    let saveResultInput: unknown;
    const deps = fakeDeps({
      jobStore: {
        ...fakeDeps().jobStore,
        saveResult: (input) => {
          saveResultInput = input;
          return Promise.resolve({
            ...jobFixture(),
            status: 'COMPLETED',
            ...(input.resultS3Key !== undefined ? { resultS3Key: input.resultS3Key } : {}),
          });
        },
      },
      s3Helper: { ...fakeDeps().s3Helper, putJson },
    });

    const job = (await saveJobResult(
      { job_id: JOB_ID, result_json: JSON.stringify(resultFixture), processor: 'aws-docx-agent' },
      deps,
    )) as Job;

    expect(putJson).toHaveBeenCalledWith(`results/${JOB_ID}/result.json`, resultFixture);
    expect(saveResultInput).toMatchObject({
      jobId: JOB_ID,
      resultS3Key: `results/${JOB_ID}/result.json`,
    });
    expect(job.resultS3Key).toBe(`results/${JOB_ID}/result.json`);
  });

  it('preserves an optional narrative field through result_json parsing rather than stripping it', async () => {
    const putJson = vi.fn(() => Promise.resolve(undefined));
    let saveResultInput: unknown;
    const deps = fakeDeps({
      jobStore: {
        ...fakeDeps().jobStore,
        saveResult: (input) => {
          saveResultInput = input;
          return Promise.resolve({ ...jobFixture(), status: 'COMPLETED', result: input.result });
        },
      },
      s3Helper: { ...fakeDeps().s3Helper, putJson },
    });
    const resultWithNarrative: JobResult = {
      ...resultFixture,
      narrative: 'This document discusses quarterly revenue growth.',
    };

    await saveJobResult(
      {
        job_id: JOB_ID,
        result_json: JSON.stringify(resultWithNarrative),
        processor: 'aws-docx-agent',
      },
      deps,
    );

    expect(putJson).toHaveBeenCalledWith(`results/${JOB_ID}/result.json`, resultWithNarrative);
    expect((saveResultInput as { result: JobResult }).result.narrative).toBe(
      'This document discusses quarterly revenue growth.',
    );
  });

  it('does not write to S3 when status is FAILED, and calls jobStore.fail instead', async () => {
    const putJson = vi.fn(() => Promise.resolve(undefined));
    const fail = vi.fn(() => Promise.resolve(jobFixture({ status: 'FAILED' })));
    const deps = fakeDeps({
      jobStore: { ...fakeDeps().jobStore, fail },
      s3Helper: { ...fakeDeps().s3Helper, putJson },
    });

    await saveJobResult(
      {
        job_id: JOB_ID,
        result_json: JSON.stringify(resultFixture),
        processor: 'aws-docx-agent',
        status: 'FAILED',
      },
      deps,
    );

    expect(putJson).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      JOB_ID,
      'Marked FAILED via save_job_result',
      expect.any(Object),
    );
  });

  it('throws ValidationError INVALID_RESULT_JSON for malformed JSON', async () => {
    const deps = fakeDeps();
    await expect(
      saveJobResult(
        { job_id: JOB_ID, result_json: '{not json', processor: 'aws-docx-agent' },
        deps,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws (zod) when result_json is valid JSON but does not match the JobResult shape', async () => {
    const deps = fakeDeps();
    await expect(
      saveJobResult(
        {
          job_id: JOB_ID,
          result_json: JSON.stringify({ summary: 'only this' }),
          processor: 'aws-docx-agent',
        },
        deps,
      ),
    ).rejects.toThrow();
  });
});
