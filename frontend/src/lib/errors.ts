/** Params for {@link ApiError}, grouped to keep the constructor at one parameter (G2). */
export interface ApiErrorParams {
  code: string;
  message: string;
  requestId?: string;
  status?: number;
}

/**
 * Typed error for every failure the API client can raise: an upstream
 * `{error:{code,message,requestId}}` envelope, a network/timeout failure, or
 * a response that fails schema validation. Mirrors the pattern in
 * DEVELOPMENT.md §3 (`lib/errors.ts`) on the frontend side.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly status?: number;

  constructor(params: ApiErrorParams) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    if (params.requestId !== undefined) this.requestId = params.requestId;
    if (params.status !== undefined) this.status = params.status;
  }
}

export const API_ERROR_CODES = {
  TIMEOUT: 'TIMEOUT',
  ABORTED: 'ABORTED',
  NETWORK: 'NETWORK',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  STREAM_INCOMPLETE: 'STREAM_INCOMPLETE',
  UNKNOWN: 'UNKNOWN',
} as const;
