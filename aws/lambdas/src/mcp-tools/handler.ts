import type { Context } from 'aws-lambda';
import { ZodError } from 'zod';
import { loadConfig } from '../lib/config.js';
import { isDocIntelError } from '../lib/errors.js';
import { createLogger } from '../lib/log.js';
import { buildMcpToolDeps } from './deps.js';
import { TOOL_REGISTRY } from './registry.js';

// AgentCore Gateway invokes a Lambda target with the tool's arguments as the raw event and
// carries the tool name as `clientContext.custom.bedrockAgentCoreToolName`, formatted
// `{targetName}___{toolName}` since one target exposes several tools.
const TOOL_NAME_FIELD = 'bedrockAgentCoreToolName';
const TOOL_NAME_SEPARATOR = '___';

const log = createLogger('mcp-tools');
// Clients are constructed once per module (cold start) per DEVELOPMENT.md §3.
const deps = buildMcpToolDeps(loadConfig());

export interface McpToolResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

function resolveToolName(context: Context): string {
  const custom = context.clientContext?.custom as Record<string, unknown> | undefined;
  const raw = custom?.[TOOL_NAME_FIELD];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`Missing clientContext.custom.${TOOL_NAME_FIELD}`);
  }
  const separatorIndex = raw.indexOf(TOOL_NAME_SEPARATOR);
  return separatorIndex >= 0 ? raw.slice(separatorIndex + TOOL_NAME_SEPARATOR.length) : raw;
}

function toToolError(error: unknown): { code: string; message: string } {
  if (isDocIntelError(error)) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      message: error.issues.map((issue) => issue.message).join('; '),
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'Unknown error',
  };
}

/**
 * Dispatch-only MCP tool handler: resolves the tool name, validates args, runs the tool,
 * and always resolves (never throws/rejects) so the Gateway gets a well-formed result either
 * way — `{ok:true,data}` or `{ok:false,error:{code,message}}`.
 */
export async function handler(event: unknown, context: Context): Promise<McpToolResult> {
  let toolName = '';
  const startedAt = Date.now();
  try {
    toolName = resolveToolName(context);
    const tool = TOOL_REGISTRY[toolName];
    if (!tool) {
      log.error('mcp_tool_failed', 'Unknown tool', { tool: toolName, code: 'UNKNOWN_TOOL' });
      log.metric('McpToolInvocation', 1, { tool: 'unknown', outcome: 'failure' });
      return { ok: false, error: { code: 'UNKNOWN_TOOL', message: `No such tool: ${toolName}` } };
    }
    const data = await tool.run(event, deps);
    log.info('mcp_tool_completed', 'MCP tool completed', {
      tool: toolName,
      durationMs: Date.now() - startedAt,
    });
    log.metric('McpToolInvocation', 1, { tool: toolName, outcome: 'success' });
    return { ok: true, data };
  } catch (error) {
    const toolError = toToolError(error);
    log.error('mcp_tool_failed', 'Tool invocation failed', {
      tool: toolName,
      code: toolError.code,
      durationMs: Date.now() - startedAt,
    });
    log.metric('McpToolInvocation', 1, { tool: toolName || 'unknown', outcome: 'failure' });
    return { ok: false, error: toolError };
  }
}
