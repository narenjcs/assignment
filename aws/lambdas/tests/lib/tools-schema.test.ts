import { describe, expect, it } from 'vitest';
import { listToolNames, loadToolSchemas } from '../../src/lib/tools-schema.js';

const EXPECTED_TOOL_NAMES = [
  'get_job',
  'list_jobs',
  'update_job_status',
  'append_job_event',
  'save_job_result',
  'extract_docx_text',
  'get_download_url',
  'get_document_content',
];

describe('loadToolSchemas', () => {
  it('loads and validates tools.json', () => {
    const tools = loadToolSchemas();
    expect(tools.length).toBe(EXPECTED_TOOL_NAMES.length);
    for (const tool of tools) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe('object');
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it('caches the parsed result across calls', () => {
    expect(loadToolSchemas()).toBe(loadToolSchemas());
  });
});

describe('listToolNames', () => {
  it('returns exactly the expected tool names, in file order', () => {
    expect(listToolNames()).toEqual(EXPECTED_TOOL_NAMES);
  });
});
