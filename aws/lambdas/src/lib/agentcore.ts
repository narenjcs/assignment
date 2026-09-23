import type {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommandOutput,
} from '@aws-sdk/client-bedrock-agentcore';
import { InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import type { JobMode } from './types.js';

type AgentCoreResponseStream = InvokeAgentRuntimeCommandOutput['response'];

// AgentCore requires `runtimeSessionId` to be >= 33 chars; a uuid jobId (36 chars) plus a
// `-{mode}` suffix comfortably clears that, and keeps the session correlated to the job
// (DEVELOPMENT.md §12 "Correlation").
export function buildRuntimeSessionId(jobId: string, mode: JobMode | 'chat'): string {
  return `${jobId}-${mode}`;
}

export interface AgentCoreInvokerDeps {
  client: BedrockAgentCoreClient;
  runtimeArn: string;
}

export interface InvokeInput {
  sessionId: string;
  payload: Record<string, unknown>;
  accept: 'application/json' | 'text/event-stream';
}

export interface InvokeResult {
  contentType: string | undefined;
  statusCode: number | undefined;
  /** Raw response stream — pipe straight through for SSE, or pass to {@link readAll}. */
  response: AgentCoreResponseStream;
}

export interface AgentCoreInvoker {
  invoke: (input: InvokeInput) => Promise<InvokeResult>;
}

/** Reads an AgentCore response stream fully and parses it as JSON. */
export async function readAll(response: InvokeResult['response']): Promise<unknown> {
  if (!response) {
    return undefined;
  }
  const text = await response.transformToString('utf-8');
  return text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
}

/** Creates an AgentCore Runtime invoker bound to a client and target runtime ARN. */
export function createAgentCoreInvoker(deps: AgentCoreInvokerDeps): AgentCoreInvoker {
  async function invoke(input: InvokeInput): Promise<InvokeResult> {
    const command = new InvokeAgentRuntimeCommand({
      agentRuntimeArn: deps.runtimeArn,
      runtimeSessionId: input.sessionId,
      contentType: 'application/json',
      accept: input.accept,
      payload: new TextEncoder().encode(JSON.stringify(input.payload)),
    });
    const res = await deps.client.send(command);
    return { contentType: res.contentType, statusCode: res.statusCode, response: res.response };
  }

  return { invoke };
}
