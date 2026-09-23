import { describe, expect, it } from 'vitest';
import { buildEvent, isTransitionAllowed } from '../../src/lib/jobs-state.js';

describe('isTransitionAllowed', () => {
  it('allows idempotent self-transitions for every status', () => {
    const statuses = [
      'PENDING_UPLOAD',
      'UPLOADED',
      'QUEUED',
      'PROCESSING',
      'COMPLETED',
      'FAILED',
    ] as const;
    for (const status of statuses) {
      expect(isTransitionAllowed(status, status)).toBe(true);
    }
  });

  it('allows the documented forward path', () => {
    expect(isTransitionAllowed('PENDING_UPLOAD', 'UPLOADED')).toBe(true);
    expect(isTransitionAllowed('UPLOADED', 'QUEUED')).toBe(true);
    expect(isTransitionAllowed('UPLOADED', 'PROCESSING')).toBe(true);
    expect(isTransitionAllowed('QUEUED', 'PROCESSING')).toBe(true);
    expect(isTransitionAllowed('PROCESSING', 'COMPLETED')).toBe(true);
  });

  it('allows a transition to FAILED from any non-terminal status', () => {
    expect(isTransitionAllowed('PENDING_UPLOAD', 'FAILED')).toBe(true);
    expect(isTransitionAllowed('UPLOADED', 'FAILED')).toBe(true);
    expect(isTransitionAllowed('QUEUED', 'FAILED')).toBe(true);
    expect(isTransitionAllowed('PROCESSING', 'FAILED')).toBe(true);
  });

  it('rejects a transition to FAILED from the terminal COMPLETED status', () => {
    expect(isTransitionAllowed('COMPLETED', 'FAILED')).toBe(false);
  });

  it('rejects skipping a step forward', () => {
    expect(isTransitionAllowed('PENDING_UPLOAD', 'QUEUED')).toBe(false);
    expect(isTransitionAllowed('PENDING_UPLOAD', 'PROCESSING')).toBe(false);
  });

  it('rejects moving backward', () => {
    expect(isTransitionAllowed('QUEUED', 'UPLOADED')).toBe(false);
    expect(isTransitionAllowed('PROCESSING', 'QUEUED')).toBe(false);
  });

  it('rejects any transition out of terminal states, other than to itself', () => {
    expect(isTransitionAllowed('COMPLETED', 'PROCESSING')).toBe(false);
    expect(isTransitionAllowed('FAILED', 'COMPLETED')).toBe(false);
    expect(isTransitionAllowed('FAILED', 'UPLOADED')).toBe(false);
  });
});

describe('buildEvent', () => {
  it('stamps the current time and carries the input fields through', () => {
    const before = Date.now();
    const event = buildEvent({
      source: 'aws',
      agent: 'api',
      tool: 'create_job',
      message: 'Job created',
    });
    const after = Date.now();

    expect(event.source).toBe('aws');
    expect(event.agent).toBe('api');
    expect(event.tool).toBe('create_job');
    expect(event.message).toBe('Job created');
    const ts = new Date(event.ts).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
