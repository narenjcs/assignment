import type { S3Client } from '@aws-sdk/client-s3';
import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { ValidationError } from './errors.js';
import { JOB_MODES } from './types.js';
import type { JobMode } from './types.js';

// Upload object keys are `uploads/{mode}/{jobId}/{safeFileName}` (docs/PLAN.md §2.2/§2.4).
const UPLOAD_KEY_PATTERN = /^uploads\/(sync|async)\/([^/]+)\/(.+)$/;
const MAX_FILE_NAME_LENGTH = 255;

export interface UploadKeyParts {
  mode: JobMode;
  jobId: string;
  fileName: string;
}

const uploadKeyPartsSchema = z.object({
  mode: z.enum(JOB_MODES),
  jobId: z.uuid(),
  fileName: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
});

function sanitizeFileName(fileName: string): string {
  const stripped = fileName.split(/[/\\]/).pop() ?? fileName;
  const safe = stripped.trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.length > 0 ? safe.slice(0, MAX_FILE_NAME_LENGTH) : 'file';
}

/** Builds a validated `uploads/{mode}/{jobId}/{safeFileName}` object key. */
export function buildUploadKey(parts: { mode: JobMode; jobId: string; fileName: string }): string {
  const safeFileName = sanitizeFileName(parts.fileName);
  const validated = uploadKeyPartsSchema.parse({
    mode: parts.mode,
    jobId: parts.jobId,
    fileName: safeFileName,
  });
  return `uploads/${validated.mode}/${validated.jobId}/${validated.fileName}`;
}

/** Parses and validates an S3 object key produced by {@link buildUploadKey}. Throws on anything else. */
export function parseUploadKey(key: string): UploadKeyParts {
  const match = UPLOAD_KEY_PATTERN.exec(key);
  if (!match) {
    throw new ValidationError('INVALID_UPLOAD_KEY', `Not a valid upload key: ${key}`);
  }
  const [, mode, jobId, fileName] = match;
  const result = uploadKeyPartsSchema.safeParse({ mode, jobId, fileName });
  if (!result.success) {
    throw new ValidationError('INVALID_UPLOAD_KEY', `Not a valid upload key: ${key}`);
  }
  return result.data;
}

export interface S3HelperDeps {
  s3: S3Client;
  bucket: string;
  ttlSeconds: number;
}

export interface HeadObjectResult {
  sizeBytes: number;
}

export interface S3Helper {
  presignUpload: (key: string, contentType: string) => Promise<string>;
  presignDownload: (key: string, ttlSeconds?: number) => Promise<string>;
  getObjectBytes: (key: string) => Promise<Uint8Array>;
  putJson: (key: string, obj: unknown) => Promise<void>;
  headObject: (key: string) => Promise<HeadObjectResult | undefined>;
}

/** Creates an S3 adapter bound to a client, bucket and default presign TTL. */
export function createS3Helper(deps: S3HelperDeps): S3Helper {
  const { s3, bucket, ttlSeconds } = deps;

  async function presignUpload(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
    return getSignedUrl(s3, command, { expiresIn: ttlSeconds });
  }

  async function presignDownload(key: string, overrideTtlSeconds?: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(s3, command, { expiresIn: overrideTtlSeconds ?? ttlSeconds });
  }

  async function getObjectBytes(key: string): Promise<Uint8Array> {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) {
      throw new ValidationError('EMPTY_OBJECT', `S3 object has no body: ${key}`);
    }
    return res.Body.transformToByteArray();
  }

  async function putJson(key: string, obj: unknown): Promise<void> {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(obj),
        ContentType: 'application/json',
      }),
    );
  }

  async function headObject(key: string): Promise<HeadObjectResult | undefined> {
    try {
      const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { sizeBytes: res.ContentLength ?? 0 };
    } catch (error) {
      if (error instanceof NotFound) {
        return undefined;
      }
      throw error;
    }
  }

  return { presignUpload, presignDownload, getObjectBytes, putJson, headObject };
}
