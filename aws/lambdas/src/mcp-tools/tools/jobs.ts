import { z } from 'zod';
import type { JobStore } from '../../lib/jobs.js';
import { ValidationError } from '../../lib/errors.js';
import type { S3Helper } from '../../lib/s3.js';
import { EVENT_SOURCES, PROCESSORS } from '../../lib/types.js';
import type { JobResult } from '../../lib/types.js';

// Status values settable via the `update_job_status` MCP tool (PENDING_UPLOAD is set only by
// the api handler at job creation — see tools.json's update_job_status description).
const MUTABLE_STATUSES = ['UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NAME_LENGTH = 100;

export interface JobsToolDeps {
  jobStore: JobStore;
  s3Helper: S3Helper;
}

/** Result-JSON archive key (PLAN §2.4/§2.7): raw validated result, written alongside the job's
 * DynamoDB record so the full payload is durably auditable even if the item is later trimmed. */
function buildResultKey(jobId: string): string {
  return `results/${jobId}/result.json`;
}

const jobResultSchema: z.ZodType<JobResult> = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  entities: z.array(z.object({ name: z.string(), type: z.string() })),
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
  narrative: z.string().optional(),
});

export const getJobArgsSchema = z.object({ job_id: z.uuid() });

export async function getJob(
  args: z.infer<typeof getJobArgsSchema>,
  deps: JobsToolDeps,
): Promise<unknown> {
  const job = await deps.jobStore.get(args.job_id);
  if (!job) {
    throw new ValidationError('JOB_NOT_FOUND', `Job ${args.job_id} not found`);
  }
  return job;
}

export const listJobsArgsSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export async function listJobs(
  args: z.infer<typeof listJobsArgsSchema>,
  deps: JobsToolDeps,
): Promise<unknown> {
  return deps.jobStore.list(args.limit === undefined ? {} : { limit: args.limit });
}

export const updateJobStatusArgsSchema = z.object({
  job_id: z.uuid(),
  status: z.enum(MUTABLE_STATUSES),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH).optional(),
  source: z.enum(EVENT_SOURCES).optional(),
  agent: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  tool: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  processor: z.enum(PROCESSORS).optional(),
});

export async function updateJobStatus(
  args: z.infer<typeof updateJobStatusArgsSchema>,
  deps: JobsToolDeps,
): Promise<unknown> {
  return deps.jobStore.updateStatus({
    jobId: args.job_id,
    status: args.status,
    event: {
      source: args.source ?? 'orchestrator',
      agent: args.agent ?? 'orchestrator',
      tool: args.tool ?? 'update_job_status',
      message: args.message ?? `Status set to ${args.status}`,
    },
    ...(args.processor ? { processor: args.processor } : {}),
  });
}

export const appendJobEventArgsSchema = z.object({
  job_id: z.uuid(),
  source: z.enum(EVENT_SOURCES),
  agent: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  tool: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});

export async function appendJobEvent(
  args: z.infer<typeof appendJobEventArgsSchema>,
  deps: JobsToolDeps,
): Promise<unknown> {
  return deps.jobStore.appendEvent(args.job_id, {
    source: args.source,
    agent: args.agent ?? 'orchestrator',
    tool: args.tool ?? 'append_job_event',
    message: args.message,
  });
}

export const saveJobResultArgsSchema = z.object({
  job_id: z.uuid(),
  result_json: z.string().min(1),
  processor: z.enum(PROCESSORS),
  status: z.enum(['COMPLETED', 'FAILED']).optional(),
  source: z.enum(EVENT_SOURCES).optional(),
  agent: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
});

function parseResultJson(resultJson: string): JobResult {
  let raw: unknown;
  try {
    raw = JSON.parse(resultJson);
  } catch {
    throw new ValidationError('INVALID_RESULT_JSON', 'result_json is not valid JSON');
  }
  return jobResultSchema.parse(raw);
}

export async function saveJobResult(
  args: z.infer<typeof saveJobResultArgsSchema>,
  deps: JobsToolDeps,
): Promise<unknown> {
  const event = {
    source: args.source ?? 'orchestrator',
    agent: args.agent ?? 'orchestrator',
    tool: 'save_job_result',
    message: args.status === 'FAILED' ? 'Result submission indicated failure' : 'Result saved',
  };
  if (args.status === 'FAILED') {
    return deps.jobStore.fail(args.job_id, 'Marked FAILED via save_job_result', event);
  }
  const result = parseResultJson(args.result_json);
  const resultS3Key = buildResultKey(args.job_id);
  await deps.s3Helper.putJson(resultS3Key, result);
  return deps.jobStore.saveResult({
    jobId: args.job_id,
    result,
    event,
    processor: args.processor,
    resultS3Key,
  });
}
