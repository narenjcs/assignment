import { describe, expect, it } from 'vitest';

import { contentTypeFor, hasAcceptedExtension, INVALID_FILE_TYPE_MESSAGE } from '../fileValidation';

describe('hasAcceptedExtension', () => {
  it('accepts .pdf and .docx (case-insensitive)', () => {
    expect(hasAcceptedExtension('report.pdf')).toBe(true);
    expect(hasAcceptedExtension('REPORT.DOCX')).toBe(true);
  });

  it('rejects other extensions', () => {
    expect(hasAcceptedExtension('image.png')).toBe(false);
    expect(hasAcceptedExtension('archive.zip')).toBe(false);
  });

  it('exposes a user-facing message for the rejection case', () => {
    expect(INVALID_FILE_TYPE_MESSAGE).toMatch(/pdf/i);
    expect(INVALID_FILE_TYPE_MESSAGE).toMatch(/docx/i);
  });
});

describe('contentTypeFor', () => {
  it('maps .pdf to application/pdf', () => {
    expect(contentTypeFor('report.PDF')).toBe('application/pdf');
  });

  it('maps everything else (docx) to the OOXML wordprocessing MIME type', () => {
    expect(contentTypeFor('report.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
});
