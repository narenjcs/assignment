// DocIntel error hierarchy — thrown from lib/services, mapped to HTTP status codes in one
// place by src/api/handler.ts (see DEVELOPMENT.md §10 error envelope).

export abstract class DocIntelError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  protected constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;
const BAD_GATEWAY = 502;

export class ValidationError extends DocIntelError {
  constructor(code: string, message: string) {
    super(code, message, BAD_REQUEST);
  }
}

export class NotFoundError extends DocIntelError {
  constructor(code: string, message: string) {
    super(code, message, NOT_FOUND);
  }
}

export class ConflictError extends DocIntelError {
  constructor(code: string, message: string) {
    super(code, message, CONFLICT);
  }
}

export class UpstreamError extends DocIntelError {
  constructor(code: string, message: string) {
    super(code, message, BAD_GATEWAY);
  }
}

export function isDocIntelError(error: unknown): error is DocIntelError {
  return error instanceof DocIntelError;
}
