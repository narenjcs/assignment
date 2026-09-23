import { z } from 'zod';
import { ValidationError } from '../../lib/errors.js';
import { JOB_MODES } from '../../lib/types.js';
import type { DocType } from '../../lib/types.js';

// Accepted upload content types map 1:1 to DocType (docs/PLAN.md §2.4).
export const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

const CONTENT_TYPE_TO_DOC_TYPE: Record<(typeof ALLOWED_CONTENT_TYPES)[number], DocType> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export function contentTypeToDocType(contentType: (typeof ALLOWED_CONTENT_TYPES)[number]): DocType {
  return CONTENT_TYPE_TO_DOC_TYPE[contentType];
}

const MAX_FILE_NAME_LENGTH = 255;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_LIST_LIMIT = 200;
// AgentCore requires `runtimeSessionId` to be >= 33 chars (see lib/agentcore.ts); a
// client-supplied sessionId that is shorter would otherwise pass validation here and only
// fail once it reaches the real AWS API.
const MIN_SESSION_ID_LENGTH = 33;
const MAX_SESSION_ID_LENGTH = 200;

export const uploadBodySchema = z.object({
  fileName: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  mode: z.enum(JOB_MODES),
  idempotencyKey: z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH).optional(),
});
export type UploadBody = z.infer<typeof uploadBodySchema>;

export const jobIdParamSchema = z.object({
  jobId: z.uuid(),
});

export const listJobsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
});
export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;

export const chatBodySchema = z.object({
  jobId: z.uuid(),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  sessionId: z.string().min(MIN_SESSION_ID_LENGTH).max(MAX_SESSION_ID_LENGTH).optional(),
});
export type ChatBody = z.infer<typeof chatBodySchema>;

/** Parses a JSON request body against a zod schema, throwing a 400 ValidationError on failure. */
export function parseJsonBody<T>(schema: z.ZodType<T>, body: string | undefined): T {
  let raw: unknown;
  try {
    raw = body ? JSON.parse(body) : {};
  } catch {
    throw new ValidationError('INVALID_JSON', 'Request body is not valid JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join('; ');
    throw new ValidationError('VALIDATION_ERROR', issues);
  }
  return result.data;
}

/** Parses query-string parameters against a zod schema, throwing a 400 ValidationError on failure. */
export function parseQuery<T>(schema: z.ZodType<T>, query: Record<string, string | undefined>): T {
  const result = schema.safeParse(query);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message).join('; ');
    throw new ValidationError('VALIDATION_ERROR', issues);
  }
  return result.data;
}
