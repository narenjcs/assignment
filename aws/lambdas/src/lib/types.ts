// Shared domain types for the DocIntel job model. Mirrors docs/PLAN.md §2.4 exactly;
// any shape change here must be reflected there in the same change.

/** Ordered job lifecycle. See DEVELOPMENT.md §9 "State machine" for allowed transitions. */
export const JOB_STATUSES = [
  'PENDING_UPLOAD',
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_MODES = ['sync', 'async'] as const;
export type JobMode = (typeof JOB_MODES)[number];

export const DOC_TYPES = ['docx', 'pdf'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const PROCESSORS = ['aws-docx-agent', 'databricks-pdf-agent'] as const;
export type Processor = (typeof PROCESSORS)[number];

export const EVENT_SOURCES = ['aws', 'databricks', 'orchestrator'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** Append-only trace entry. Never edited or removed once written. */
export interface JobEvent {
  ts: string;
  source: EventSource;
  agent: string;
  tool: string;
  message: string;
}

export interface JobResultEntity {
  name: string;
  type: string;
}

export interface JobResult {
  summary: string;
  keyPoints: string[];
  entities: JobResultEntity[];
  topics: string[];
  sentiment: string;
  language: string;
  pageCount: number;
  wordCount: number;
  extractionMethod: string;
  model: string;
  // Explicit `| undefined` (rather than a bare `?:`) so this matches zod's `.optional()`
  // output type exactly under `exactOptionalPropertyTypes` — these fields are only ever
  // populated by parsing untrusted `result_json` through a zod schema (mcp-tools/tools/jobs.ts).
  ucTable?: string | undefined;
  databricksRunId?: string | undefined;
  volumePath?: string | undefined;
  // The orchestrator's streamed synthesis in sync mode (PLAN §2.4); absent for async/other
  // processors that don't produce a narrative.
  narrative?: string | undefined;
}

/** DynamoDB `docintel-jobs` item shape (PK `jobId`, GSI `byCreatedAt` on `entity`/`createdAt`). */
export interface Job {
  jobId: string;
  entity: 'JOB';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  fileName: string;
  contentType: string;
  docType: DocType;
  s3Key: string;
  sizeBytes?: number;
  mode: JobMode;
  status: JobStatus;
  processor?: Processor;
  events: JobEvent[];
  result?: JobResult;
  resultS3Key?: string;
  error?: string;
  ttl: number;
}

export const SSE_EVENT_TYPES = ['status', 'tool', 'token', 'result', 'error', 'done'] as const;
export type SseEventType = (typeof SSE_EVENT_TYPES)[number];

/** SSE frame payload: `data: <json>\n\n` per DEVELOPMENT.md §10. */
export interface SseEvent {
  type: SseEventType;
  ts: string;
  [key: string]: unknown;
}
