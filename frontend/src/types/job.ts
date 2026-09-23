import { z } from 'zod';

// Mirrors docs/PLAN.md §2.4 (DynamoDB `docintel-jobs` item) exactly, minus the
// DynamoDB-only storage attributes (`entity`, `ttl`) that the API never
// surfaces to clients.

export const JOB_STATUSES = [
  'PENDING_UPLOAD',
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const DOC_TYPES = ['docx', 'pdf'] as const;
export const DocTypeSchema = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof DocTypeSchema>;

export const JOB_MODES = ['sync', 'async'] as const;
export const JobModeSchema = z.enum(JOB_MODES);
export type JobMode = z.infer<typeof JobModeSchema>;

export const EVENT_SOURCES = ['aws', 'databricks', 'orchestrator'] as const;
export const EventSourceSchema = z.enum(EVENT_SOURCES);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const PROCESSORS = ['aws-docx-agent', 'databricks-pdf-agent'] as const;
export const ProcessorSchema = z.enum(PROCESSORS);
export type Processor = z.infer<typeof ProcessorSchema>;

export const JobEventSchema = z.object({
  ts: z.string(),
  source: EventSourceSchema,
  agent: z.string(),
  tool: z.string().optional(),
  message: z.string(),
});
export type JobEvent = z.infer<typeof JobEventSchema>;

export const EntitySchema = z.object({
  name: z.string(),
  type: z.string(),
});
export type Entity = z.infer<typeof EntitySchema>;

export const JobResultSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  entities: z.array(EntitySchema),
  topics: z.array(z.string()),
  sentiment: z.string(),
  language: z.string(),
  pageCount: z.number(),
  wordCount: z.number(),
  extractionMethod: z.string(),
  model: z.string(),
  ucTable: z.string().optional(),
  databricksRunId: z.string().optional(),
  volumePath: z.string().optional(),
});
export type JobResult = z.infer<typeof JobResultSchema>;

// Only these are guaranteed on the wire; the rest are set later in the job's
// lifecycle (e.g. `sizeBytes` only after the S3 trigger runs) and so must be
// optional here (PLAN.md §2.6 review round 2).
export const JobSchema = z.object({
  jobId: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  docType: DocTypeSchema,
  s3Key: z.string(),
  mode: JobModeSchema,
  status: JobStatusSchema,
  events: z.array(JobEventSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  sizeBytes: z.number().optional(),
  processor: ProcessorSchema.optional(),
  result: JobResultSchema.optional(),
  error: z.string().optional(),
  completedAt: z.string().optional(),
  resultS3Key: z.string().optional(),
});
export type Job = z.infer<typeof JobSchema>;

/** Statuses that will never change again without user action (a new upload). */
export const TERMINAL_STATUSES: readonly JobStatus[] = ['COMPLETED', 'FAILED'];

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
