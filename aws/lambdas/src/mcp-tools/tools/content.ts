import { z } from 'zod';
import { ValidationError } from '../../lib/errors.js';
import type { JobStore } from '../../lib/jobs.js';
import type { S3Helper } from '../../lib/s3.js';

// One chunk per call. A Lambda's synchronous response is capped at 6 MB and base64 inflates by
// ~4/3; 3 MB raw (4 MB encoded) leaves headroom. A 3.9 MB chunk was verified end to end through
// the Gateway on 2026-09-25, so this is well inside what actually works.
export const MAX_CHUNK_BYTES = 3 * 1024 * 1024;

export interface ContentToolDeps {
  jobStore: JobStore;
  s3Helper: S3Helper;
}

export const getDocumentContentArgsSchema = z.object({
  job_id: z.uuid(),
  offset: z.coerce.number().int().nonnegative().optional(),
  length: z.coerce.number().int().positive().max(MAX_CHUNK_BYTES).optional(),
});

/**
 * `get_document_content` — one base64-encoded byte range of the job's document, served through
 * the MCP Gateway (PLAN §2.7). Callers loop from `offset: 0` until `done`, so there is no
 * document size limit. Exists because Databricks serverless egress cannot reach S3 at all
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
  const offset = args.offset ?? 0;
  const length = args.length ?? MAX_CHUNK_BYTES;
  const { bytes, totalBytes } = await deps.s3Helper.getObjectRange(job.s3Key, offset, length);
  return {
    contentBase64: Buffer.from(bytes).toString('base64'),
    offset,
    chunkBytes: bytes.byteLength,
    sizeBytes: totalBytes,
    done: offset + bytes.byteLength >= totalBytes,
    fileName: job.fileName,
    contentType: job.contentType,
  };
}
