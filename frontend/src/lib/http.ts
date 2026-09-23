import type { z } from 'zod';

import { API_ERROR_CODES, ApiError } from './errors';
import { ErrorEnvelopeSchema } from '../types/api';

// Generic fetch helpers shared by lib/api.ts: every request gets an explicit
// timeout (G8) and every failure is normalized into an ApiError. Kept
// framework-agnostic and DocIntel-URL-agnostic so it is easy to unit test.

export interface TimeoutHandle {
  signal: AbortSignal;
  /** Resets the countdown; call after each chunk of a long-lived stream. */
  touch: () => void;
  cancel: () => void;
  /** Why `signal` aborted, if it has: our own idle timer, or the caller's own signal. */
  abortReason: () => 'timeout' | 'external' | null;
}

/**
 * Wraps an internal idle-timeout controller around an optional caller-owned
 * `externalSignal`, so a fetch always has one signal to key off of. Honours a
 * signal that is *already* aborted when this is called (G8): otherwise its
 * `'abort'` event would never fire, since the listener attaches too late.
 */
export function createTimeoutHandle(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): TimeoutHandle {
  const controller = new AbortController();
  let reason: 'timeout' | 'external' | null = null;
  const onTimeout = (): void => {
    reason = 'timeout';
    controller.abort();
  };
  const onExternalAbort = (): void => {
    reason = 'external';
    controller.abort();
  };
  let timer = setTimeout(onTimeout, timeoutMs);
  const touch = (): void => {
    clearTimeout(timer);
    timer = setTimeout(onTimeout, timeoutMs);
  };
  if (externalSignal?.aborted) {
    onExternalAbort();
  } else {
    externalSignal?.addEventListener('abort', onExternalAbort);
  }
  const cancel = (): void => {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  };
  return { signal: controller.signal, touch, cancel, abortReason: () => reason };
}

/** Maps a caught error to an ApiError; `timeout` (when supplied) tells an internal timeout from a caller abort apart. */
export function toApiError(err: unknown, timeout?: TimeoutHandle): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    if (timeout?.abortReason() === 'external') {
      return new ApiError({ code: API_ERROR_CODES.ABORTED, message: 'Request was aborted' });
    }
    return new ApiError({ code: API_ERROR_CODES.TIMEOUT, message: 'Request timed out' });
  }
  if (err instanceof Error) {
    return new ApiError({ code: API_ERROR_CODES.NETWORK, message: err.message });
  }
  return new ApiError({ code: API_ERROR_CODES.UNKNOWN, message: 'Unknown request failure' });
}

function buildApiError(params: {
  code: string;
  message: string;
  status: number;
  requestId?: string | undefined;
}): ApiError {
  const { code, message, status, requestId } = params;
  return requestId === undefined
    ? new ApiError({ code, message, status })
    : new ApiError({ code, message, status, requestId });
}

/** Maps a non-OK Response to an ApiError, decoding the `{error:{...}}` envelope when present. */
export async function toErrorFromResponse(res: Response): Promise<ApiError> {
  const headerRequestId = res.headers.get('x-request-id') ?? undefined;
  try {
    const body: unknown = await res.json();
    const parsed = ErrorEnvelopeSchema.safeParse(body);
    if (parsed.success) {
      return buildApiError({
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        status: res.status,
        requestId: parsed.data.error.requestId ?? headerRequestId,
      });
    }
  } catch {
    // Body was not JSON / not the envelope shape; fall through to the generic mapping.
  }
  return buildApiError({
    code: API_ERROR_CODES.UNKNOWN,
    message: `Request failed with status ${res.status}`,
    status: res.status,
    requestId: headerRequestId,
  });
}

async function parseJsonBody<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await res.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      code: API_ERROR_CODES.INVALID_RESPONSE,
      message: `Response did not match the expected shape: ${parsed.error.issues[0]?.message ?? ''}`,
      status: res.status,
    });
  }
  return parsed.data;
}

export interface FetchJsonOptions {
  init?: RequestInit;
  timeoutMs: number;
}

/** Fetches JSON, validates it with `schema`, and throws a typed ApiError on any failure. */
export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: FetchJsonOptions,
): Promise<T> {
  const { init = {}, timeoutMs } = options;
  const timeout = createTimeoutHandle(timeoutMs, init.signal ?? undefined);
  try {
    const res = await fetch(url, { ...init, signal: timeout.signal });
    if (!res.ok) throw await toErrorFromResponse(res);
    return await parseJsonBody(res, schema);
  } catch (err) {
    throw toApiError(err, timeout);
  } finally {
    timeout.cancel();
  }
}

/** Starts a streaming POST (SSE) request; throws if the server rejects it before streaming starts. */
export async function fetchStream(
  url: string,
  body: unknown,
  timeout: TimeoutHandle,
): Promise<Response> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    if (!res.ok) throw await toErrorFromResponse(res);
    return res;
  } catch (err) {
    throw toApiError(err, timeout);
  }
}
