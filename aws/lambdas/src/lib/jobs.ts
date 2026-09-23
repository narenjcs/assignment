import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConflictError, NotFoundError } from './errors.js';
import { decodeCursor, encodeCursor, buildMutationExpression } from './jobs-expressions.js';
import type { MutationParams } from './jobs-expressions.js';
import { findJobByIdempotencyKey, reserveIdempotencyKey } from './jobs-idempotency.js';
import { buildEvent, isTransitionAllowed } from './jobs-state.js';
import type { TraceEventInput } from './jobs-state.js';
import type { DocType, Job, JobMode, JobResult, JobStatus, Processor } from './types.js';

export type { TraceEventInput } from './jobs-state.js';

const SECONDS_PER_DAY = 86_400;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const GSI_NAME = 'byCreatedAt';

export interface JobStoreDeps {
  ddb: DynamoDBDocumentClient;
  tableName: string;
  ttlDays: number;
}

export interface CreateJobInput {
  jobId: string;
  fileName: string;
  contentType: string;
  docType: DocType;
  mode: JobMode;
  s3Key: string;
  idempotencyKey?: string;
}

export interface UpdateStatusInput {
  jobId: string;
  status: JobStatus;
  event: TraceEventInput;
  processor?: Processor;
  s3Key?: string;
  sizeBytes?: number;
}

export interface ListJobsInput {
  limit?: number;
  cursor?: string;
}

export interface ListJobsResult {
  items: Job[];
  nextCursor?: string;
}

async function getJob(deps: JobStoreDeps, jobId: string): Promise<Job | undefined> {
  const res = await deps.ddb.send(new GetCommand({ TableName: deps.tableName, Key: { jobId } }));
  return res.Item as Job | undefined;
}

async function requireJob(deps: JobStoreDeps, jobId: string): Promise<Job> {
  const job = await getJob(deps, jobId);
  if (!job) {
    throw new NotFoundError('JOB_NOT_FOUND', `Job ${jobId} not found`);
  }
  return job;
}

async function createJob(deps: JobStoreDeps, input: CreateJobInput): Promise<Job> {
  const now = new Date().toISOString();
  if (input.idempotencyKey) {
    const reserved = await reserveIdempotencyKey(deps, input.idempotencyKey, input.jobId, now);
    if (!reserved) {
      const existing = await findJobByIdempotencyKey(deps, input.idempotencyKey, (jobId) =>
        getJob(deps, jobId),
      );
      if (existing) {
        return existing;
      }
      throw new ConflictError(
        'IDEMPOTENCY_KEY_IN_USE',
        `Idempotency key ${input.idempotencyKey} is already in use`,
      );
    }
  }
  const job: Job = {
    jobId: input.jobId,
    entity: 'JOB',
    createdAt: now,
    updatedAt: now,
    fileName: input.fileName,
    contentType: input.contentType,
    docType: input.docType,
    s3Key: input.s3Key,
    mode: input.mode,
    status: 'PENDING_UPLOAD',
    events: [
      buildEvent({ source: 'aws', agent: 'api', tool: 'create_job', message: 'Job created' }),
    ],
    ttl: Math.floor(Date.now() / 1000) + deps.ttlDays * SECONDS_PER_DAY,
  };
  try {
    await deps.ddb.send(
      new PutCommand({
        TableName: deps.tableName,
        Item: job,
        ConditionExpression: 'attribute_not_exists(jobId)',
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ConflictError('JOB_ID_ALREADY_EXISTS', `Job ${job.jobId} already exists`);
    }
    throw error;
  }
  return job;
}

async function listJobs(deps: JobStoreDeps, input: ListJobsInput): Promise<ListJobsResult> {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const res = await deps.ddb.send(
    new QueryCommand({
      TableName: deps.tableName,
      IndexName: GSI_NAME,
      KeyConditionExpression: 'entity = :entity',
      ExpressionAttributeValues: { ':entity': 'JOB' },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: input.cursor ? decodeCursor(input.cursor) : undefined,
    }),
  );
  const items = (res.Items ?? []) as Job[];
  return res.LastEvaluatedKey
    ? { items, nextCursor: encodeCursor(res.LastEvaluatedKey) }
    : { items };
}

/**
 * When `expectedStatus` is given, the update is conditioned on the job still being in that
 * status, so two concurrent writers racing off the same pre-read (e.g. the S3 trigger and
 * the API's own `/process` HEAD-check both observing `PENDING_UPLOAD`) can't both succeed —
 * the loser gets a `ConditionalCheckFailedException`, mapped here to `ConflictError` instead
 * of silently double-applying the mutation (PLAN §2.6 idempotency hardening).
 */
async function applyMutation(
  deps: JobStoreDeps,
  params: MutationParams,
  expectedStatus?: JobStatus,
): Promise<Job> {
  const now = new Date().toISOString();
  const { updateExpression, names, values } = buildMutationExpression(params, now);
  let conditionExpression = 'attribute_exists(jobId)';
  if (expectedStatus) {
    names['#currentStatus'] = 'status';
    values[':expectedStatus'] = expectedStatus;
    conditionExpression += ' AND #currentStatus = :expectedStatus';
  }
  try {
    const res = await deps.ddb.send(
      new UpdateCommand({
        TableName: deps.tableName,
        Key: { jobId: params.jobId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: conditionExpression,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return res.Attributes as Job;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ConflictError(
        'JOB_STATUS_CHANGED',
        `Job ${params.jobId} status changed concurrently (expected ${expectedStatus ?? 'to exist'})`,
      );
    }
    throw error;
  }
}

async function updateJobStatus(deps: JobStoreDeps, input: UpdateStatusInput): Promise<Job> {
  const existing = await requireJob(deps, input.jobId);
  if (!isTransitionAllowed(existing.status, input.status)) {
    throw new ConflictError(
      'INVALID_TRANSITION',
      `Cannot transition job ${input.jobId} from ${existing.status} to ${input.status}`,
    );
  }
  const set: Record<string, unknown> = { status: input.status };
  if (input.processor) {
    set.processor = input.processor;
  }
  if (input.s3Key) {
    set.s3Key = input.s3Key;
  }
  if (input.sizeBytes !== undefined) {
    set.sizeBytes = input.sizeBytes;
  }
  return applyMutation(deps, { jobId: input.jobId, event: input.event, set }, existing.status);
}

async function appendJobEvent(
  deps: JobStoreDeps,
  jobId: string,
  event: TraceEventInput,
): Promise<Job> {
  await requireJob(deps, jobId);
  return applyMutation(deps, { jobId, event });
}

export interface SaveResultInput {
  jobId: string;
  result: JobResult;
  event: TraceEventInput;
  processor?: Processor;
  resultS3Key?: string;
}

async function saveJobResult(deps: JobStoreDeps, input: SaveResultInput): Promise<Job> {
  const existing = await requireJob(deps, input.jobId);
  if (!isTransitionAllowed(existing.status, 'COMPLETED')) {
    throw new ConflictError(
      'INVALID_TRANSITION',
      `Cannot complete job ${input.jobId} from status ${existing.status}`,
    );
  }
  const set: Record<string, unknown> = { status: 'COMPLETED' };
  if (input.processor) {
    set.processor = input.processor;
  }
  if (input.resultS3Key) {
    set.resultS3Key = input.resultS3Key;
  }
  return applyMutation(deps, { jobId: input.jobId, event: input.event, set, result: input.result });
}

async function failJob(
  deps: JobStoreDeps,
  jobId: string,
  message: string,
  event: TraceEventInput,
): Promise<Job> {
  const existing = await requireJob(deps, jobId);
  if (!isTransitionAllowed(existing.status, 'FAILED')) {
    throw new ConflictError(
      'INVALID_TRANSITION',
      `Cannot fail job ${jobId} from terminal status ${existing.status}`,
    );
  }
  return applyMutation(
    deps,
    { jobId, event, set: { status: 'FAILED' }, error: message },
    existing.status,
  );
}

export interface JobStore {
  create: (input: CreateJobInput) => Promise<Job>;
  get: (jobId: string) => Promise<Job | undefined>;
  list: (input: ListJobsInput) => Promise<ListJobsResult>;
  updateStatus: (input: UpdateStatusInput) => Promise<Job>;
  appendEvent: (jobId: string, event: TraceEventInput) => Promise<Job>;
  saveResult: (input: SaveResultInput) => Promise<Job>;
  fail: (jobId: string, message: string, event: TraceEventInput) => Promise<Job>;
}

/**
 * Creates a JobStore bound to a DynamoDB document client and table. Every mutation appends
 * an append-only trace event and bumps `updatedAt`; status changes are validated against the
 * job state machine and re-running a step with the same target status is a safe no-op.
 */
export function createJobStore(deps: JobStoreDeps): JobStore {
  return {
    create: (input) => createJob(deps, input),
    get: (jobId) => getJob(deps, jobId),
    list: (input) => listJobs(deps, input),
    updateStatus: (input) => updateJobStatus(deps, input),
    appendEvent: (jobId, event) => appendJobEvent(deps, jobId, event),
    saveResult: (input) => saveJobResult(deps, input),
    fail: (jobId, message, event) => failJob(deps, jobId, message, event),
  };
}
