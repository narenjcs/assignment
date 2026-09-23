import type { Job } from '../../types/job';

/**
 * Shared Job fixture for tests (round-2 review item 14): a full, realistic
 * job with events/processor so it satisfies both a rich rendering test
 * (JobDetail) and a lean polling test (useJobPolling) via overrides.
 */
export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: 'j1',
    fileName: 'quarterly-report.pdf',
    contentType: 'application/pdf',
    docType: 'pdf',
    s3Key: 'uploads/j1',
    sizeBytes: 1024,
    mode: 'sync',
    status: 'PROCESSING',
    processor: 'databricks-pdf-agent',
    events: [
      {
        ts: '2026-01-01T00:00:01.000Z',
        source: 'orchestrator',
        agent: 'Router',
        message: 'Job queued',
      },
      {
        ts: '2026-01-01T00:00:02.000Z',
        source: 'databricks',
        agent: 'PDF Agent',
        tool: 'extract_text',
        message: 'Extracting text',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:02.000Z',
    ...overrides,
  };
}
