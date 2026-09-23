import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// aws/lambdas/tools.json is the single source of truth for the Gateway tool catalogue
// (DEVELOPMENT.md §11). This module loads and validates it; do not rename tools here.

const toolInputSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()),
});

const toolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: toolInputSchema,
});

export type ToolSchema = z.infer<typeof toolSchema>;

const toolsFileSchema = z.array(toolSchema);

const toolsFilePath = fileURLToPath(new URL('../../tools.json', import.meta.url));

let cachedTools: ToolSchema[] | undefined;

/** Loads and validates `tools.json`, caching the parsed result for the life of the module. */
export function loadToolSchemas(): ToolSchema[] {
  if (!cachedTools) {
    const raw = readFileSync(toolsFilePath, 'utf-8');
    cachedTools = toolsFileSchema.parse(JSON.parse(raw) as unknown);
  }
  return cachedTools;
}

/** Convenience accessor used by the registry parity test. */
export function listToolNames(): string[] {
  return loadToolSchemas().map((tool) => tool.name);
}
