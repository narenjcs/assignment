import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Job } from './types.js';

export interface IdempotencyDeps {
  ddb: DynamoDBDocumentClient;
  tableName: string;
}

function idempotencyKeyId(key: string): string {
  return `IDEMP#${key}`;
}

/**
 * Idempotency mappings are stored as separate items keyed `IDEMP#{key}` with `entity:
 * "IDEMPOTENCY_KEY"`, so they never appear in `byCreatedAt` GSI queries (which filter on
 * `entity = "JOB"`) without requiring a schema or index change.
 */
export async function findJobByIdempotencyKey(
  deps: IdempotencyDeps,
  key: string,
  getJob: (jobId: string) => Promise<Job | undefined>,
): Promise<Job | undefined> {
  const res = await deps.ddb.send(
    new GetCommand({ TableName: deps.tableName, Key: { jobId: idempotencyKeyId(key) } }),
  );
  const mapping = res.Item as { targetJobId?: string } | undefined;
  return mapping?.targetJobId ? getJob(mapping.targetJobId) : undefined;
}

/**
 * Reserves an idempotency key for `targetJobId` via a conditional put, *before* the job
 * itself is created — this closes the race where two concurrent requests with the same key
 * both pass a check-then-act read and each create their own job. Returns `false` (instead of
 * throwing) when another request already holds the key, so the caller can fall back to
 * reading the winner's job.
 */
export async function reserveIdempotencyKey(
  deps: IdempotencyDeps,
  key: string,
  targetJobId: string,
  now: string,
): Promise<boolean> {
  try {
    await deps.ddb.send(
      new PutCommand({
        TableName: deps.tableName,
        Item: {
          jobId: idempotencyKeyId(key),
          entity: 'IDEMPOTENCY_KEY',
          targetJobId,
          createdAt: now,
        },
        ConditionExpression: 'attribute_not_exists(jobId)',
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw error;
  }
}
