import type { Job, JobEvent } from '../../types/job';

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

// Events below mirror the real agent/tool names the backend emits (see
// `src/lib/flow-signals.ts` module docstring for the source lines), so
// `flow-model.test.ts` exercises `computeFlowModel` against realistic traces
// rather than the loosely-named events `makeJob` uses for non-flow tests.

const ts = (offsetSeconds: number): string =>
  new Date(2026, 0, 1, 0, 0, offsetSeconds).toISOString();

const createJobEvent: JobEvent = {
  ts: ts(0),
  source: 'aws',
  agent: 'api',
  tool: 'create_job',
  message: 'Job created',
};
const s3TriggerEvent: JobEvent = {
  ts: ts(1),
  source: 'aws',
  agent: 's3-trigger',
  tool: 's3:ObjectCreated',
  message: 'Upload detected',
};
const orchestratorEvent: JobEvent = {
  ts: ts(2),
  source: 'orchestrator',
  agent: 'orchestrator',
  message: 'Routing job',
};

/** A DOCX job that stayed entirely in AWS and completed (aws/agents/docx_agent/enrich.py). */
export function makeDocxJob(overrides: Partial<Job> = {}): Job {
  return makeJob({
    fileName: 'memo.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    docType: 'docx',
    processor: 'aws-docx-agent',
    status: 'COMPLETED',
    events: [
      createJobEvent,
      s3TriggerEvent,
      orchestratorEvent,
      { ts: ts(3), source: 'aws', agent: 'docx-agent', message: 'Extracting text' },
      {
        ts: ts(4),
        source: 'aws',
        agent: 'docx-agent',
        tool: 'save_job_result',
        message: 'Result saved',
      },
    ],
    ...overrides,
  });
}

const ingestEvent: JobEvent = {
  ts: ts(3),
  source: 'databricks',
  agent: 'databricks-pdf-agent',
  tool: 'ingest',
  message: 'ingest completed',
};
const pdfSubstepEvents: JobEvent[] = [
  ingestEvent,
  {
    ts: ts(4),
    source: 'databricks',
    agent: 'databricks-pdf-agent',
    tool: 'extract',
    message: 'extract completed',
  },
  {
    ts: ts(5),
    source: 'databricks',
    agent: 'databricks-pdf-agent',
    tool: 'enrich',
    message: 'enrich completed',
  },
  {
    ts: ts(6),
    source: 'databricks',
    agent: 'databricks-pdf-agent',
    tool: 'persist',
    message: 'persist completed',
  },
];

/** A PDF job that crossed into Databricks, ran the full pipeline, and called back into the AWS
 * Gateway (`update_job_status`/`save_job_result` with `source: 'databricks'`) — the cross-cloud
 * MCP proof (UI-PLAN §1). */
export function makePdfSyncJob(overrides: Partial<Job> = {}): Job {
  return makeJob({
    mode: 'sync',
    status: 'COMPLETED',
    events: [
      createJobEvent,
      s3TriggerEvent,
      orchestratorEvent,
      ...pdfSubstepEvents,
      {
        ts: ts(7),
        source: 'databricks',
        agent: 'orchestrator',
        tool: 'update_job_status',
        message: 'Status set to COMPLETED',
      },
      {
        ts: ts(8),
        source: 'databricks',
        agent: 'orchestrator',
        tool: 'save_job_result',
        message: 'Result saved',
      },
    ],
    ...overrides,
  });
}

/** A PDF job still mid-pipeline (async mode, no live stream to watch — client is polling). */
export function makePdfAsyncJob(overrides: Partial<Job> = {}): Job {
  return makeJob({
    mode: 'async',
    status: 'PROCESSING',
    events: [createJobEvent, s3TriggerEvent, orchestratorEvent, ingestEvent],
    ...overrides,
  });
}

/** A PDF job that failed partway through the Databricks pipeline; the agent's best-effort
 * `update_job_status(FAILED)` callback still reaches the AWS Gateway (`agent.py::_run` /
 * `_report_status_best_effort`). */
export function makeFailedPdfJob(overrides: Partial<Job> = {}): Job {
  return makeJob({
    mode: 'sync',
    status: 'FAILED',
    error: 'extract failed: unreadable PDF',
    events: [
      createJobEvent,
      s3TriggerEvent,
      orchestratorEvent,
      ingestEvent,
      {
        ts: ts(4),
        source: 'databricks',
        agent: 'orchestrator',
        tool: 'update_job_status',
        message: 'Status set to FAILED',
      },
    ],
    ...overrides,
  });
}
