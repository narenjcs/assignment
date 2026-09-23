import mammoth from 'mammoth';
import { z } from 'zod';
import { ValidationError } from '../../lib/errors.js';
import type { JobStore } from '../../lib/jobs.js';
import type { S3Helper } from '../../lib/s3.js';

const MAX_TEXT_CHARS = 20_000;
const WORDS_PER_PAGE = 450;

export interface DocxToolDeps {
  jobStore: JobStore;
  s3Helper: S3Helper;
}

export const extractDocxTextArgsSchema = z.object({ job_id: z.uuid() });

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Prefers form-feed page breaks when mammoth preserves them; otherwise estimates from an
 * average of 450 words/page, always at least one page. */
function countPages(text: string, wordCount: number): number {
  const formFeeds = (text.match(/\f/g) ?? []).length;
  return formFeeds > 0 ? formFeeds + 1 : Math.max(1, Math.ceil(wordCount / WORDS_PER_PAGE));
}

function truncate(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_TEXT_CHARS
    ? { text: text.slice(0, MAX_TEXT_CHARS), truncated: true }
    : { text, truncated: false };
}

/**
 * `extract_docx_text` — downloads the job's DOCX from S3 and extracts its raw text via
 * mammoth (PLAN §2.7). Only valid for `docType: "docx"`; PDFs go through the Databricks
 * PDF agent instead.
 */
export async function extractDocxText(
  args: z.infer<typeof extractDocxTextArgsSchema>,
  deps: DocxToolDeps,
): Promise<unknown> {
  const job = await deps.jobStore.get(args.job_id);
  if (!job) {
    throw new ValidationError('JOB_NOT_FOUND', `Job ${args.job_id} not found`);
  }
  if (job.docType !== 'docx') {
    throw new ValidationError(
      'UNSUPPORTED_DOC_TYPE',
      `Job ${args.job_id} is docType ${job.docType}, not docx`,
    );
  }
  const bytes = await deps.s3Helper.getObjectBytes(job.s3Key);
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const wordCount = countWords(value);
  const { text, truncated } = truncate(value);
  return {
    text,
    truncated,
    wordCount,
    pageCount: countPages(value, wordCount),
    extractionMethod: 'mammoth',
  };
}
