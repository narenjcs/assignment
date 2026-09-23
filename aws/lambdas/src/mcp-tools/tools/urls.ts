import { z } from 'zod';
import { ValidationError } from '../../lib/errors.js';
import type { JobStore } from '../../lib/jobs.js';
import type { S3Helper } from '../../lib/s3.js';

const DEFAULT_EXPIRES_SECONDS = 900;
// DEVELOPMENT.md §12 security checklist: presigned URLs must be <= 15 min (900s).
const MAX_EXPIRES_SECONDS = 900;

export interface UrlsToolDeps {
  jobStore: JobStore;
  s3Helper: S3Helper;
}

export const getDownloadUrlArgsSchema = z.object({
  job_id: z.uuid(),
  expires_seconds: z.coerce.number().int().positive().max(MAX_EXPIRES_SECONDS).optional(),
});

/** `get_download_url` — a short-lived presigned GET so an external system (e.g. the
 * Databricks PDF agent) can fetch the job's document from S3 (PLAN §2.7). */
export async function getDownloadUrl(
  args: z.infer<typeof getDownloadUrlArgsSchema>,
  deps: UrlsToolDeps,
): Promise<unknown> {
  const job = await deps.jobStore.get(args.job_id);
  if (!job) {
    throw new ValidationError('JOB_NOT_FOUND', `Job ${args.job_id} not found`);
  }
  const expiresIn = args.expires_seconds ?? DEFAULT_EXPIRES_SECONDS;
  const downloadUrl = await deps.s3Helper.presignDownload(job.s3Key, expiresIn);
  return { downloadUrl, expiresIn, fileName: job.fileName, contentType: job.contentType };
}
