import type { JobEvent, JobStatus } from './types.js';

/**
 * Status transitions allowed *from* each state, per DEVELOPMENT.md §9 "State machine".
 * COMPLETED and FAILED are terminal: nothing, including a failure report, may transition
 * out of them.
 */
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  PENDING_UPLOAD: ['UPLOADED', 'FAILED'],
  UPLOADED: ['QUEUED', 'PROCESSING', 'FAILED'],
  QUEUED: ['PROCESSING', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

export interface TraceEventInput {
  source: JobEvent['source'];
  agent: string;
  tool: string;
  message: string;
}

/** A self-transition (idempotent re-run of the same step) is always allowed; otherwise the
 * target must be reachable from `current` per {@link TRANSITIONS} (terminal states reject
 * everything, including FAILED). */
export function isTransitionAllowed(current: JobStatus, target: JobStatus): boolean {
  return current === target || TRANSITIONS[current].includes(target);
}

export function buildEvent(input: TraceEventInput): JobEvent {
  return { ts: new Date().toISOString(), ...input };
}
