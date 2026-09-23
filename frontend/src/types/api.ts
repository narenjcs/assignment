import { z } from 'zod';

import { JobModeSchema, JobSchema } from './job';

// Mirrors docs/PLAN.md §2.6 (API contract) and docs/DEVELOPMENT.md §10
// (error envelope, list shape).

export const CreateUploadRequestSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  mode: JobModeSchema,
  idempotencyKey: z.string().optional(),
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequestSchema>;

export const CreateUploadResponseSchema = z.object({
  jobId: z.string(),
  uploadUrl: z.string(),
  s3Key: z.string(),
});
export type CreateUploadResponse = z.infer<typeof CreateUploadResponseSchema>;

// `GET /jobs` follows the general list shape from DEVELOPMENT.md §10.
export const JobsListResponseSchema = z.object({
  items: z.array(JobSchema),
  nextCursor: z.string().optional(),
});
export type JobsListResponse = z.infer<typeof JobsListResponseSchema>;

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
