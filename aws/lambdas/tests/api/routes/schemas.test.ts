import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/lib/errors.js';
import {
  chatBodySchema,
  contentTypeToDocType,
  jobIdParamSchema,
  listJobsQuerySchema,
  parseJsonBody,
  parseQuery,
  uploadBodySchema,
} from '../../../src/api/routes/schemas.js';

describe('contentTypeToDocType', () => {
  it('maps PDF and DOCX content types to their doc types', () => {
    expect(contentTypeToDocType('application/pdf')).toBe('pdf');
    expect(
      contentTypeToDocType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('docx');
  });
});

describe('parseJsonBody', () => {
  it('parses a valid JSON body against the schema', () => {
    const body = parseJsonBody(
      uploadBodySchema,
      JSON.stringify({
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        mode: 'sync',
      }),
    );
    expect(body.fileName).toBe('a.pdf');
  });

  it('defaults to an empty object when the body is undefined', () => {
    expect(() => parseJsonBody(chatBodySchema, undefined)).toThrow(ValidationError);
  });

  it('throws ValidationError with INVALID_JSON for malformed JSON', () => {
    expect(() => parseJsonBody(uploadBodySchema, '{not json')).toThrow(ValidationError);
    try {
      parseJsonBody(uploadBodySchema, '{not json');
    } catch (error) {
      expect((error as ValidationError).code).toBe('INVALID_JSON');
    }
  });

  it('throws ValidationError with the zod issue messages joined for a schema mismatch', () => {
    try {
      parseJsonBody(uploadBodySchema, JSON.stringify({ fileName: '' }));
      throw new Error('expected parseJsonBody to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('parseQuery', () => {
  it('parses valid query params against the schema', () => {
    const result = parseQuery(listJobsQuerySchema, { limit: '10' });
    expect(result.limit).toBe(10);
  });

  it('throws ValidationError for an invalid jobId param', () => {
    expect(() => parseQuery(jobIdParamSchema, { jobId: 'not-a-uuid' })).toThrow(ValidationError);
  });
});
