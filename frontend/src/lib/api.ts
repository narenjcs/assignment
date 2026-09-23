import { getConfig } from './config';
import { API_ERROR_CODES, ApiError } from './errors';
import {
  createTimeoutHandle,
  fetchJson,
  fetchStream,
  toApiError,
  type TimeoutHandle,
} from './http';
import { SseParser } from './sse';
import { CreateUploadResponseSchema, JobsListResponseSchema } from '../types/api';
import type { CreateUploadRequest, CreateUploadResponse, JobsListResponse } from '../types/api';
import { JobSchema } from '../types/job';
import type { Job } from '../types/job';
import type { SseEvent } from '../types/sse';

// Typed client for the API contract in docs/PLAN.md §2.6. Every request has
// an explicit timeout; SSE requests use an idle timeout that resets on every
// chunk so a slow-but-alive stream (kept warm by `: ping` frames) is not
// killed early.
const DEFAULT_TIMEOUT_MS = 15_000;
const STREAM_IDLE_TIMEOUT_MS = 20_000;

async function apiUrl(path: string): Promise<string> {
  const { apiUrl: base } = await getConfig();
  return `${base.replace(/\/$/, '')}${path}`;
}

export async function createUpload(input: CreateUploadRequest): Promise<CreateUploadResponse> {
  const url = await apiUrl('/uploads');
  return fetchJson(url, CreateUploadResponseSchema, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  });
}

// Presigned PUTs get a size-scaled timeout instead of the default 15s: a
// ~25 KB/s floor, at least 30s, so large files aren't killed mid-upload.
const UPLOAD_MIN_TIMEOUT_MS = 30_000;
const UPLOAD_BYTES_PER_SECOND_FLOOR = 25_000;

function uploadTimeoutMs(fileSizeBytes: number): number {
  return Math.max(
    UPLOAD_MIN_TIMEOUT_MS,
    Math.ceil(fileSizeBytes / UPLOAD_BYTES_PER_SECOND_FLOOR) * 1000,
  );
}

/** PUTs the file straight to the S3 presigned URL from createUpload. */
export async function uploadFile(
  uploadUrl: string,
  file: File,
  contentType: string,
): Promise<void> {
  const timeout = createTimeoutHandle(uploadTimeoutMs(file.size));
  try {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: file,
      signal: timeout.signal,
    });
    if (!res.ok) {
      throw new ApiError({
        code: API_ERROR_CODES.UNKNOWN,
        message: `Upload failed with status ${res.status}`,
        status: res.status,
      });
    }
  } catch (err) {
    throw toApiError(err, timeout);
  } finally {
    timeout.cancel();
  }
}

export async function listJobs(params: { limit?: number } = {}): Promise<JobsListResponse> {
  const query = params.limit !== undefined ? `?limit=${params.limit}` : '';
  const url = await apiUrl(`/jobs${query}`);
  return fetchJson(url, JobsListResponseSchema, { timeoutMs: DEFAULT_TIMEOUT_MS });
}

export async function getJob(jobId: string): Promise<Job> {
  const url = await apiUrl(`/jobs/${encodeURIComponent(jobId)}`);
  return fetchJson(url, JobSchema, { timeoutMs: DEFAULT_TIMEOUT_MS });
}

interface SseReadContext {
  decoder: TextDecoder;
  parser: SseParser;
  timeout: TimeoutHandle;
  onEvent: (event: SseEvent) => void;
}

function readSseStream(
  res: Response,
  timeout: TimeoutHandle,
  onEvent: (event: SseEvent) => void,
): Promise<boolean> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new ApiError({
      code: API_ERROR_CODES.NETWORK,
      message: 'Streaming response had no body',
    });
  }
  const ctx: SseReadContext = {
    decoder: new TextDecoder(),
    parser: new SseParser(),
    timeout,
    onEvent,
  };
  return readSseLoop(reader, ctx);
}

function applyParsedEvents(events: SseEvent[], onEvent: (event: SseEvent) => void): boolean {
  let sawDone = false;
  for (const event of events) {
    if (event.type === 'done') sawDone = true;
    onEvent(event);
  }
  return sawDone;
}

async function readSseLoop(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ctx: SseReadContext,
): Promise<boolean> {
  let sawDone = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    ctx.timeout.touch();
    if (
      applyParsedEvents(ctx.parser.push(ctx.decoder.decode(value, { stream: true })), ctx.onEvent)
    )
      sawDone = true;
  }
  // EOF: flush any pending decoder bytes, then emit a final frame that never
  // got a trailing blank line (SSE spec — EOF terminates the last event).
  if (applyParsedEvents(ctx.parser.push(ctx.decoder.decode()), ctx.onEvent)) sawDone = true;
  if (applyParsedEvents(ctx.parser.flush(), ctx.onEvent)) sawDone = true;
  return sawDone;
}

/** Consumes an SSE POST endpoint (process/chat), forwarding every parsed frame to `onEvent`. */
async function consumeSseStream(
  url: string,
  body: unknown,
  onEvent: (event: SseEvent) => void,
  externalSignal?: AbortSignal,
): Promise<void> {
  const timeout = createTimeoutHandle(STREAM_IDLE_TIMEOUT_MS, externalSignal);
  let sawDone = false;
  try {
    const res = await fetchStream(url, body, timeout);
    sawDone = await readSseStream(res, timeout, onEvent);
  } catch (err) {
    throw toApiError(err, timeout);
  } finally {
    timeout.cancel();
  }
  if (!sawDone) {
    throw new ApiError({
      code: API_ERROR_CODES.STREAM_INCOMPLETE,
      message: 'Stream closed before a "done" frame; re-fetch the job to resync.',
    });
  }
}

export async function processJob(
  jobId: string,
  onEvent: (event: SseEvent) => void,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const url = await apiUrl(`/jobs/${encodeURIComponent(jobId)}/process`);
  await consumeSseStream(url, {}, onEvent, options.signal);
}

export async function chat(
  jobId: string,
  message: string,
  onEvent: (event: SseEvent) => void,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const url = await apiUrl('/chat');
  // Session id is derived server-side as `${jobId}-chat` (PLAN.md §2.6); the
  // client must not send one, since the server schema may reject unknown fields.
  await consumeSseStream(url, { jobId, message }, onEvent, options.signal);
}
