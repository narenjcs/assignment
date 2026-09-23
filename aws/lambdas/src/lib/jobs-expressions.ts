import { z } from 'zod';
import { ValidationError } from './errors.js';
import type { JobResult } from './types.js';
import type { TraceEventInput } from './jobs-state.js';
import { buildEvent } from './jobs-state.js';

export interface MutationParams {
  jobId: string;
  event: TraceEventInput;
  set?: Record<string, unknown>;
  result?: JobResult;
  error?: string;
}

export interface MutationExpression {
  updateExpression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
}

/**
 * Builds the single `UpdateCommand` expression used for every job mutation: it always bumps
 * `updatedAt` and appends one trace event via `list_append`, plus conditionally sets
 * arbitrary attributes, the final `result`, an `error` message, and `completedAt`.
 */
export function buildMutationExpression(params: MutationParams, now: string): MutationExpression {
  const names: Record<string, string> = { '#events': 'events', '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = {
    ':newEvent': [buildEvent(params.event)],
    ':emptyList': [],
    ':now': now,
  };
  const sets = ['#updatedAt = :now'];
  for (const [key, value] of Object.entries(params.set ?? {})) {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    sets.push(`#${key} = :${key}`);
  }
  if (params.result) {
    names['#result'] = 'result';
    values[':result'] = params.result;
    sets.push('#result = :result');
  }
  if (params.error) {
    names['#error'] = 'error';
    values[':error'] = params.error;
    sets.push('#error = :error');
  }
  if (params.set?.status === 'COMPLETED') {
    names['#completedAt'] = 'completedAt';
    values[':completedAt'] = now;
    sets.push('#completedAt = :completedAt');
  }
  const updateExpression = `SET ${sets.join(', ')}, #events = list_append(if_not_exists(#events, :emptyList), :newEvent)`;
  return { updateExpression, names, values };
}

/** Opaque pagination cursor: base64url of the DynamoDB `LastEvaluatedKey`. */
export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), 'utf-8').toString('base64url');
}

const cursorSchema = z.object({
  jobId: z.string().min(1),
  entity: z.string().min(1),
  createdAt: z.string().min(1),
});

/** Decodes and validates an opaque pagination cursor, never leaking a raw parse error or an
 * arbitrary shape through to the DynamoDB `ExclusiveStartKey`. */
export function decodeCursor(cursor: string): Record<string, unknown> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  } catch {
    throw new ValidationError('INVALID_CURSOR', 'Cursor is not valid base64url-encoded JSON');
  }
  const result = cursorSchema.safeParse(decoded);
  if (!result.success) {
    throw new ValidationError('INVALID_CURSOR', 'Cursor does not match the expected shape');
  }
  return result.data;
}
