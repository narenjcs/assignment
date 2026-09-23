import type { S3Event, S3EventRecord } from 'aws-lambda';
import { buildRuntimeSessionId } from '../lib/agentcore.js';
import { loadConfig } from '../lib/config.js';
import { ConflictError } from '../lib/errors.js';
import { createLogger } from '../lib/log.js';
import { parseUploadKey } from '../lib/s3.js';
import type { S3TriggerDeps } from './deps.js';
import { buildS3TriggerDeps } from './deps.js';

const log = createLogger('s3-trigger');
// Clients are constructed once per module (cold start) per DEVELOPMENT.md §3.
const deps = buildS3TriggerDeps(loadConfig());

const HTTP_STATUS_OK_MIN = 200;
const HTTP_STATUS_OK_MAX = 299;

/**
 * Invokes the orchestrator and checks only that it accepted the request — the ack body is
 * discarded and deliberately never JSON-parsed, so a non-JSON 200 response (or an empty
 * body) must never be treated as a failure. A non-2xx status, however, means the orchestrator
 * rejected the request and the job must be marked FAILED by the caller.
 */
async function invokeOrchestrator(deps: S3TriggerDeps, jobId: string): Promise<void> {
  const result = await deps.agentCore.invoke({
    sessionId: buildRuntimeSessionId(jobId, 'async'),
    payload: { jobId, mode: 'async' },
    accept: 'application/json',
  });
  const status = result.statusCode;
  if (status === undefined || status < HTTP_STATUS_OK_MIN || status > HTTP_STATUS_OK_MAX) {
    throw new Error(`Orchestrator invoke returned status ${status ?? 'unknown'}`);
  }
  await result.response?.transformToString('utf-8');
}

/** S3 event keys are URL-encoded (spaces become `+`), unlike keys we build ourselves. */
function decodeS3Key(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

/**
 * Queues an already-`UPLOADED` async job: marks it `QUEUED`, then fires the orchestrator.
 * A failed invoke is recorded as a job failure rather than thrown, per PLAN §2.2 step 3 —
 * the upload itself succeeded, only kicking off processing did not.
 */
async function queueAsync(deps: S3TriggerDeps, jobId: string): Promise<void> {
  await deps.jobStore.updateStatus({
    jobId,
    status: 'QUEUED',
    event: {
      source: 'aws',
      agent: 's3-trigger',
      tool: 's3:ObjectCreated',
      message: 'Queued for async processing',
    },
  });
  try {
    await invokeOrchestrator(deps, jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to invoke orchestrator';
    await deps.jobStore.fail(jobId, message, {
      source: 'aws',
      agent: 's3-trigger',
      tool: 's3:ObjectCreated',
      message: `Orchestrator invoke failed: ${message}`,
    });
  }
}

/**
 * Marks a job `UPLOADED`, or — if it has already moved past `PENDING_UPLOAD` (a duplicate S3
 * delivery, or the API's own `/process` HEAD-check winning the race) — only appends an event
 * without touching status. Returns whether this call performed the real, first transition, so
 * the caller knows whether to kick off async processing (PLAN §2.6 "s3-trigger is idempotent").
 */
async function markUploaded(
  deps: S3TriggerDeps,
  jobId: string,
  key: string,
  sizeBytes: number,
): Promise<{ fresh: boolean }> {
  const job = await deps.jobStore.get(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }
  const event = {
    source: 'aws' as const,
    agent: 's3-trigger',
    tool: 's3:ObjectCreated',
    message: `Uploaded ${key}`,
  };
  if (job.status !== 'PENDING_UPLOAD') {
    await deps.jobStore.appendEvent(jobId, event);
    return { fresh: false };
  }
  try {
    await deps.jobStore.updateStatus({ jobId, status: 'UPLOADED', event, s3Key: key, sizeBytes });
    return { fresh: true };
  } catch (error) {
    // Lost a race against a concurrent writer (e.g. the API's /process HEAD-check) that
    // already moved the job past PENDING_UPLOAD between our read and the conditional write —
    // the other writer already recorded the transition, so this is not a real failure.
    if (error instanceof ConflictError) {
      return { fresh: false };
    }
    throw error;
  }
}

/** Non-upload keys (e.g. future prefixes) and malformed upload keys are logged and skipped
 * so one bad record never blocks the rest of the batch. */
async function handleRecord(deps: S3TriggerDeps, record: S3EventRecord): Promise<void> {
  const key = decodeS3Key(record.s3.object.key);
  if (!key.startsWith('uploads/')) {
    return;
  }
  try {
    const parts = parseUploadKey(key);
    const { fresh } = await markUploaded(deps, parts.jobId, key, record.s3.object.size);
    if (fresh && parts.mode === 'async') {
      await queueAsync(deps, parts.jobId);
    }
  } catch (error) {
    log.error('s3_trigger_record_failed', 'Failed to process S3 event record', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    await handleRecord(deps, record);
  }
}
