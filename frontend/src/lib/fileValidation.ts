// Client-side file-type guard for the upload Dropzone. The server re-validates
// content type; this only exists to give fast feedback before the upload.

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx'];
export const INVALID_FILE_TYPE_MESSAGE = 'Only .pdf and .docx files are accepted.';

export function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Falls back to a MIME type from the extension when File.type is empty (browser-dependent). */
export function contentTypeFor(fileName: string): string {
  return fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : DOCX_CONTENT_TYPE;
}
