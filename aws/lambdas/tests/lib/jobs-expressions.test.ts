import { describe, expect, it } from 'vitest';
import {
  buildMutationExpression,
  decodeCursor,
  encodeCursor,
} from '../../src/lib/jobs-expressions.js';
import { ValidationError } from '../../src/lib/errors.js';

const NOW = '2026-01-01T00:00:00.000Z';
const EVENT = { source: 'aws' as const, agent: 'api', tool: 'create_job', message: 'Job created' };

describe('buildMutationExpression', () => {
  it('builds the base expression with just an event, no set/result/error', () => {
    const { updateExpression, names, values } = buildMutationExpression(
      { jobId: 'job-1', event: EVENT },
      NOW,
    );

    expect(updateExpression).toBe(
      'SET #updatedAt = :now, #events = list_append(if_not_exists(#events, :emptyList), :newEvent)',
    );
    expect(names).toEqual({ '#events': 'events', '#updatedAt': 'updatedAt' });
    expect(values[':now']).toBe(NOW);
    expect(values[':emptyList']).toEqual([]);
    expect(values[':newEvent']).toEqual([{ ts: expect.any(String), ...EVENT }]);
  });

  it('adds a SET clause per field in `set`', () => {
    const { updateExpression, names, values } = buildMutationExpression(
      { jobId: 'job-1', event: EVENT, set: { status: 'QUEUED' } },
      NOW,
    );
    expect(updateExpression).toContain('#status = :status');
    expect(names['#status']).toBe('status');
    expect(values[':status']).toBe('QUEUED');
  });

  it('adds #completedAt only when status is set to COMPLETED', () => {
    const completed = buildMutationExpression(
      { jobId: 'job-1', event: EVENT, set: { status: 'COMPLETED' } },
      NOW,
    );
    expect(completed.updateExpression).toContain('#completedAt = :completedAt');
    expect(completed.values[':completedAt']).toBe(NOW);

    const queued = buildMutationExpression(
      { jobId: 'job-1', event: EVENT, set: { status: 'QUEUED' } },
      NOW,
    );
    expect(queued.updateExpression).not.toContain('#completedAt');
  });

  it('adds a #result clause when result is given', () => {
    const result = {
      summary: 's',
      keyPoints: [],
      entities: [],
      topics: [],
      sentiment: 'neutral',
      language: 'en',
      pageCount: 1,
      wordCount: 1,
      extractionMethod: 'mammoth',
      model: 'm',
    };
    const { updateExpression, names, values } = buildMutationExpression(
      { jobId: 'job-1', event: EVENT, result },
      NOW,
    );
    expect(updateExpression).toContain('#result = :result');
    expect(names['#result']).toBe('result');
    expect(values[':result']).toBe(result);
  });

  it('adds an #error clause when error is given', () => {
    const { updateExpression, names, values } = buildMutationExpression(
      { jobId: 'job-1', event: EVENT, error: 'boom' },
      NOW,
    );
    expect(updateExpression).toContain('#error = :error');
    expect(names['#error']).toBe('error');
    expect(values[':error']).toBe('boom');
  });

  it('combines set, result and error clauses together', () => {
    const result = {
      summary: 's',
      keyPoints: [],
      entities: [],
      topics: [],
      sentiment: 'neutral',
      language: 'en',
      pageCount: 1,
      wordCount: 1,
      extractionMethod: 'mammoth',
      model: 'm',
    };
    const { updateExpression } = buildMutationExpression(
      { jobId: 'job-1', event: EVENT, set: { status: 'FAILED' }, result, error: 'boom' },
      NOW,
    );
    expect(updateExpression).toContain('#status = :status');
    expect(updateExpression).toContain('#result = :result');
    expect(updateExpression).toContain('#error = :error');
    expect(updateExpression).not.toContain('#completedAt');
  });
});

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a DynamoDB key through base64url', () => {
    const key = { jobId: 'job-1', entity: 'JOB', createdAt: NOW };
    const cursor = encodeCursor(key);
    expect(typeof cursor).toBe('string');
    expect(cursor).not.toMatch(/[+/=]/);
    expect(decodeCursor(cursor)).toEqual(key);
  });

  it('throws ValidationError INVALID_CURSOR for malformed base64/JSON', () => {
    expect(() => decodeCursor('not-valid-base64url-json!!!')).toThrow(ValidationError);
    try {
      decodeCursor('not-valid-base64url-json!!!');
    } catch (error) {
      expect((error as ValidationError).code).toBe('INVALID_CURSOR');
    }
  });

  it('throws ValidationError INVALID_CURSOR when the decoded shape does not match', () => {
    const badCursor = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf-8').toString('base64url');
    expect(() => decodeCursor(badCursor)).toThrow(ValidationError);
    try {
      decodeCursor(badCursor);
    } catch (error) {
      expect((error as ValidationError).code).toBe('INVALID_CURSOR');
    }
  });
});
