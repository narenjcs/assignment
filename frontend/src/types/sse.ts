import { z } from 'zod';

import { EventSourceSchema, JobResultSchema } from './job';

// Mirrors docs/PLAN.md §2.6's pinned SSE frame shapes exactly (single source
// of truth shared with `aws/lambdas` stream-proxy and `docintel_common/events.py`).
// Every schema is `.passthrough()`'d so extra, unlisted fields never fail
// validation; only a missing/unknown `type`, or a missing field this table
// marks as required, is treated as malformed.

export const SSE_EVENT_TYPES = ['status', 'tool', 'token', 'result', 'error', 'done'] as const;

const SseStatusEventSchema = z
  .object({
    type: z.literal('status'),
    ts: z.string(),
    jobId: z.string(),
    status: z.string(),
    message: z.string().optional(),
    source: EventSourceSchema.optional(),
    agent: z.string().optional(),
  })
  .passthrough();

const SseToolEventSchema = z
  .object({
    type: z.literal('tool'),
    ts: z.string(),
    jobId: z.string(),
    name: z.string(),
    phase: z.enum(['start', 'end']),
    source: EventSourceSchema,
    agent: z.string().optional(),
    summary: z.string().optional(),
  })
  .passthrough();

const SseTokenEventSchema = z
  .object({
    type: z.literal('token'),
    text: z.string(),
    ts: z.string().optional(),
  })
  .passthrough();

const SseResultEventSchema = z
  .object({
    type: z.literal('result'),
    ts: z.string(),
    jobId: z.string(),
    result: JobResultSchema,
  })
  .passthrough();

const SseErrorEventSchema = z
  .object({
    type: z.literal('error'),
    ts: z.string(),
    jobId: z.string().optional(),
    error: z.object({ code: z.string(), message: z.string() }),
  })
  .passthrough();

const SseDoneEventSchema = z
  .object({
    type: z.literal('done'),
    ts: z.string(),
    jobId: z.string().optional(),
  })
  .passthrough();

export const SseEventSchema = z.discriminatedUnion('type', [
  SseStatusEventSchema,
  SseToolEventSchema,
  SseTokenEventSchema,
  SseResultEventSchema,
  SseErrorEventSchema,
  SseDoneEventSchema,
]);

export type SseEvent = z.infer<typeof SseEventSchema>;
export type SseStatusEvent = z.infer<typeof SseStatusEventSchema>;
export type SseToolEvent = z.infer<typeof SseToolEventSchema>;
export type SseTokenEvent = z.infer<typeof SseTokenEventSchema>;
export type SseResultEvent = z.infer<typeof SseResultEventSchema>;
export type SseErrorEvent = z.infer<typeof SseErrorEventSchema>;
export type SseDoneEvent = z.infer<typeof SseDoneEventSchema>;

/** Builds a well-formed `error` frame, e.g. for parse failures or dropped streams. */
export function makeSseError(message: string, code = 'MALFORMED_FRAME'): SseErrorEvent {
  return { type: 'error', ts: new Date().toISOString(), error: { code, message } };
}
