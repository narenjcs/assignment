import { buildRuntimeSessionId } from '../../lib/agentcore.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import type { Job, JobStatus } from '../../lib/types.js';
import type { RouteContext } from '../context.js';
import { openSseStream, writeJson } from '../respond.js';
import { proxyAgentCoreStream } from '../stream-proxy.js';
import { jobIdParamSchema, listJobsQuerySchema, parseQuery } from './schemas.js';

const OK_STATUS = 200;
// QUEUED/PROCESSING are deliberately excluded: async processing is already in flight for
// those, and allowing /process to re-trigger it would start a second concurrent orchestrator
// run for the same job (PLAN §2.6 idempotency hardening).
const PROCESSABLE_STATUSES: ReadonlySet<JobStatus> = new Set(['UPLOADED']);

/** `GET /jobs?limit=&cursor=` — newest first, paginated via an opaque cursor. */
export async function routeJobsList(ctx: RouteContext): Promise<void> {
  const query = parseQuery(listJobsQuerySchema, ctx.query);
  const result = await ctx.deps.jobStore.list({
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
  });
  writeJson(ctx.responseStream, ctx.requestId, OK_STATUS, result);
}

async function requireJob(ctx: RouteContext, params: Record<string, string>): Promise<Job> {
  const { jobId } = parseQuery(jobIdParamSchema, params);
  const job = await ctx.deps.jobStore.get(jobId);
  if (!job) {
    throw new NotFoundError('JOB_NOT_FOUND', `Job ${jobId} not found`);
  }
  return job;
}

/** `GET /jobs/{jobId}` — the full job document, or 404. */
export async function routeJobGet(
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const job = await requireJob(ctx, params);
  writeJson(ctx.responseStream, ctx.requestId, OK_STATUS, job);
}

/**
 * If `job` is `PENDING_UPLOAD`, HEAD-checks S3 directly: the event trigger can lag the
 * browser's PUT by hundreds of ms, so a client hitting `/process` right after upload
 * should not have to wait for it. Found → transitions to `UPLOADED` and proceeds; missing →
 * throws the same 409 the caller would have gotten anyway (PLAN §2.6).
 */
async function ensureUploaded(ctx: RouteContext, job: Job): Promise<Job> {
  if (job.status !== 'PENDING_UPLOAD') {
    return job;
  }
  const head = await ctx.deps.s3Helper.headObject(job.s3Key);
  if (!head) {
    throw new ConflictError(
      'JOB_NOT_PROCESSABLE',
      `Job ${job.jobId} is ${job.status} and cannot be processed`,
    );
  }
  try {
    return await ctx.deps.jobStore.updateStatus({
      jobId: job.jobId,
      status: 'UPLOADED',
      s3Key: job.s3Key,
      sizeBytes: head.sizeBytes,
      event: {
        source: 'aws',
        agent: 'api',
        tool: 's3:HeadObject',
        message: `Confirmed upload via HEAD for ${job.s3Key}`,
      },
    });
  } catch (error) {
    // Lost a race against the S3 trigger, which already moved the job past PENDING_UPLOAD
    // between our read and this conditional write — re-read and use its result instead of
    // failing the request (PLAN §2.6 idempotency hardening).
    if (error instanceof ConflictError) {
      const refreshed = await ctx.deps.jobStore.get(job.jobId);
      if (refreshed) {
        return refreshed;
      }
    }
    throw error;
  }
}

/**
 * `POST /jobs/{jobId}/process` — runs the sync workflow: validates the job is in a
 * processable state, then opens an SSE stream and pipes the orchestrator's response
 * straight through (PLAN §2.2 "Sync" step 3; DEVELOPMENT.md §9 "Streaming pipeline").
 */
export async function routeJobProcess(
  ctx: RouteContext,
  params: Record<string, string>,
): Promise<void> {
  const initialJob = await requireJob(ctx, params);
  const job = await ensureUploaded(ctx, initialJob);
  if (!PROCESSABLE_STATUSES.has(job.status)) {
    throw new ConflictError(
      'JOB_NOT_PROCESSABLE',
      `Job ${job.jobId} is ${job.status} and cannot be processed`,
    );
  }
  const stream = openSseStream(ctx.responseStream, ctx.requestId);
  await proxyAgentCoreStream(
    ctx.deps.agentCore,
    {
      sessionId: buildRuntimeSessionId(job.jobId, 'sync'),
      payload: { jobId: job.jobId, mode: 'sync' },
      accept: 'text/event-stream',
    },
    stream,
    job.jobId,
  );
}
