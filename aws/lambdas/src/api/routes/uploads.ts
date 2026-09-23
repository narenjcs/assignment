import { randomUUID } from 'node:crypto';
import { buildUploadKey } from '../../lib/s3.js';
import type { RouteContext } from '../context.js';
import { writeJson } from '../respond.js';
import { contentTypeToDocType, parseJsonBody, uploadBodySchema } from './schemas.js';

const CREATED_STATUS = 201;

/** `POST /uploads` — creates a PENDING_UPLOAD job and returns a presigned S3 PUT URL. */
export async function routeUploads(ctx: RouteContext): Promise<void> {
  const body = parseJsonBody(uploadBodySchema, ctx.body);
  const jobId = randomUUID();
  const docType = contentTypeToDocType(body.contentType);
  const s3Key = buildUploadKey({ mode: body.mode, jobId, fileName: body.fileName });

  const job = await ctx.deps.jobStore.create({
    jobId,
    fileName: body.fileName,
    contentType: body.contentType,
    docType,
    mode: body.mode,
    s3Key,
    ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
  });

  const uploadUrl = await ctx.deps.s3Helper.presignUpload(job.s3Key, job.contentType);
  writeJson(ctx.responseStream, ctx.requestId, CREATED_STATUS, {
    jobId: job.jobId,
    uploadUrl,
    s3Key: job.s3Key,
    expiresIn: ctx.deps.config.PRESIGN_TTL_SECONDS,
  });
}
