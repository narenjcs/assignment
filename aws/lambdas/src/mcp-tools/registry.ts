import type { JobStore } from '../lib/jobs.js';
import type { S3Helper } from '../lib/s3.js';
import { getDocumentContent, getDocumentContentArgsSchema } from './tools/content.js';
import { extractDocxText, extractDocxTextArgsSchema } from './tools/docx.js';
import {
  appendJobEvent,
  appendJobEventArgsSchema,
  getJob,
  getJobArgsSchema,
  listJobs,
  listJobsArgsSchema,
  saveJobResult,
  saveJobResultArgsSchema,
  updateJobStatus,
  updateJobStatusArgsSchema,
} from './tools/jobs.js';
import { getDownloadUrl, getDownloadUrlArgsSchema } from './tools/urls.js';

export interface McpToolDeps {
  jobStore: JobStore;
  s3Helper: S3Helper;
}

export interface ToolEntry {
  run: (args: unknown, deps: McpToolDeps) => Promise<unknown>;
}

interface ParsableSchema<TArgs> {
  parse: (raw: unknown) => TArgs;
}

/** Wraps a strongly-typed tool function behind a uniform `(unknown) => Promise<unknown>`
 * boundary, validating raw MCP arguments against the tool's own zod schema first. */
function entry<TArgs>(
  schema: ParsableSchema<TArgs>,
  run: (args: TArgs, deps: McpToolDeps) => Promise<unknown>,
): ToolEntry {
  return { run: (raw, deps) => run(schema.parse(raw), deps) };
}

// Registry/command dispatch (DEVELOPMENT.md §9). Keys must match aws/lambdas/tools.json's
// `name` fields exactly — verified by the tools.json parity test.
export const TOOL_REGISTRY: Record<string, ToolEntry> = {
  get_job: entry(getJobArgsSchema, getJob),
  list_jobs: entry(listJobsArgsSchema, listJobs),
  update_job_status: entry(updateJobStatusArgsSchema, updateJobStatus),
  append_job_event: entry(appendJobEventArgsSchema, appendJobEvent),
  save_job_result: entry(saveJobResultArgsSchema, saveJobResult),
  extract_docx_text: entry(extractDocxTextArgsSchema, extractDocxText),
  get_download_url: entry(getDownloadUrlArgsSchema, getDownloadUrl),
  get_document_content: entry(getDocumentContentArgsSchema, getDocumentContent),
};
