import { z } from 'zod';
import { ValidationError } from '../../lib/errors.js';
import type { JobStore } from '../../lib/jobs.js';
import type { S3Helper } from '../../lib/s3.js';

// A Lambda's synchronous response is capped at 6 MB and base64 inflates by ~4/3, so 4 MB of
// raw document is the largest that still fits with room for the JSON envelope.
export const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

export interface ContentToolDeps {
  jobStore: JobStore;
  s3Helper: S3Helper;
}

export const getDocumentContentArgsSchema = z.object({ job_id: z.uuid() });

/**
 * `get_document_content` — the job's document bytes, base64-encoded, served through the MCP
 * Gateway (PLAN §2.7). Exists because Databricks serverless egress cannot reach S3 at all
 * (PLAN §0.1 item 1), so the presigned URL from `get_download_url` is unusable from there;
 * the Gateway is the one AWS endpoint it can reach.
 */
export async function getDocumentContent(
  args: z.infer<typeof getDocumentContentArgsSchema>,
  deps: ContentToolDeps,
): Promise<unknown> {
  const job = await deps.jobStore.get(args.job_id);
  if (!job) {
    throw new ValidationError('JOB_NOT_FOUND', `Job ${args.job_id} not found`);
  }
  if (job.sizeBytes !== undefined && job.sizeBytes > MAX_CONTENT_BYTES) {
    throw new ValidationError(
      'DOCUMENT_TOO_LARGE',
      `Job ${args.job_id} is ${job.sizeBytes} bytes; inline content is capped at ${MAX_CONTENT_BYTES}`,
    );
  }
  const bytes = await deps.s3Helper.getObjectBytes(job.s3Key);
  if (bytes.byteLength > MAX_CONTENT_BYTES) {
    throw new ValidationError(
      'DOCUMENT_TOO_LARGE',
      `Job ${args.job_id} is ${bytes.byteLength} bytes; inline content is capped at ${MAX_CONTENT_BYTES}`,
    );
  }
  return {
    contentBase64: Buffer.from(bytes).toString('base64'),
    sizeBytes: bytes.byteLength,
    fileName: job.fileName,
    contentType: job.contentType,
  };
}
