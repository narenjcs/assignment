import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOOL_REGISTRY } from '../../src/mcp-tools/registry.js';

interface ToolSpec {
  name: string;
  inputSchema: { required?: string[] };
}

const toolsJsonPath = fileURLToPath(new URL('../../tools.json', import.meta.url));
const tools = JSON.parse(readFileSync(toolsJsonPath, 'utf-8')) as ToolSpec[];

describe('TOOL_REGISTRY / tools.json parity', () => {
  it('has exactly the same tool names as tools.json, in either order', () => {
    const jsonNames = tools.map((tool) => tool.name).sort();
    const registryNames = Object.keys(TOOL_REGISTRY).sort();
    expect(registryNames).toEqual(jsonNames);
  });

  it('rejects empty args for every tool that declares at least one required field', async () => {
    for (const tool of tools) {
      const entry = TOOL_REGISTRY[tool.name];
      expect(entry, `missing registry entry for ${tool.name}`).toBeDefined();
      if ((tool.inputSchema.required ?? []).length === 0) {
        continue;
      }
      await expect(
        async () => entry?.run({}, { jobStore: {} as never, s3Helper: {} as never }),
        `${tool.name} should reject empty args`,
      ).rejects.toThrow();
    }
  });

  it('get_job requires job_id', async () => {
    await expect(async () =>
      TOOL_REGISTRY.get_job?.run({}, { jobStore: {} as never, s3Helper: {} as never }),
    ).rejects.toThrow();
  });

  it('save_job_result requires job_id, result_json and processor', async () => {
    await expect(async () =>
      TOOL_REGISTRY.save_job_result?.run(
        { job_id: '11111111-1111-4111-8111-111111111111' },
        { jobStore: {} as never, s3Helper: {} as never },
      ),
    ).rejects.toThrow();
  });
});
