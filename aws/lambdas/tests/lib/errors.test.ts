import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  DocIntelError,
  NotFoundError,
  UpstreamError,
  ValidationError,
  isDocIntelError,
} from '../../src/lib/errors.js';

describe('DocIntel error hierarchy', () => {
  it('maps ValidationError to 400', () => {
    const error = new ValidationError('BAD_INPUT', 'nope');
    expect(error.httpStatus).toBe(400);
    expect(error.code).toBe('BAD_INPUT');
    expect(error.message).toBe('nope');
    expect(error.name).toBe('ValidationError');
    expect(error).toBeInstanceOf(DocIntelError);
    expect(error).toBeInstanceOf(Error);
  });

  it('maps NotFoundError to 404', () => {
    expect(new NotFoundError('X', 'y').httpStatus).toBe(404);
  });

  it('maps ConflictError to 409', () => {
    expect(new ConflictError('X', 'y').httpStatus).toBe(409);
  });

  it('maps UpstreamError to 502', () => {
    expect(new UpstreamError('X', 'y').httpStatus).toBe(502);
  });

  it('isDocIntelError distinguishes DocIntel errors from plain errors', () => {
    expect(isDocIntelError(new ValidationError('X', 'y'))).toBe(true);
    expect(isDocIntelError(new Error('plain'))).toBe(false);
    expect(isDocIntelError('not an error')).toBe(false);
    expect(isDocIntelError(undefined)).toBe(false);
  });
});
