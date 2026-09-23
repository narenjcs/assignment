import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildRuntimeSessionId, createAgentCoreInvoker, readAll } from '../../src/lib/agentcore.js';

describe('buildRuntimeSessionId', () => {
  it('joins jobId and mode with a dash and stays above the 33-char AgentCore minimum', () => {
    const jobId = '11111111-1111-4111-8111-111111111111';
    const sessionId = buildRuntimeSessionId(jobId, 'sync');
    expect(sessionId).toBe(`${jobId}-sync`);
    expect(sessionId.length).toBeGreaterThanOrEqual(33);
  });

  it('supports the chat mode', () => {
    expect(buildRuntimeSessionId('job-1', 'chat')).toBe('job-1-chat');
  });
});

describe('readAll', () => {
  it('returns undefined when there is no response stream', async () => {
    expect(await readAll(undefined)).toBeUndefined();
  });

  it('parses the stream text as JSON', async () => {
    const response = {
      transformToString: () => Promise.resolve(JSON.stringify({ ok: true })),
    } as never;
    expect(await readAll(response)).toEqual({ ok: true });
  });

  it('returns undefined for an empty stream body', async () => {
    const response = { transformToString: () => Promise.resolve('') } as never;
    expect(await readAll(response)).toBeUndefined();
  });
});

describe('createAgentCoreInvoker', () => {
  const bedrockMock = mockClient(BedrockAgentCoreClient);
  const invoker = createAgentCoreInvoker({
    client: new BedrockAgentCoreClient({ region: 'us-east-1' }),
    runtimeArn: 'arn:aws:bedrock-agentcore:us-east-1:1:runtime/orchestrator',
  });

  beforeEach(() => {
    bedrockMock.reset();
  });

  it('invokes with the runtime ARN, session id, content type and JSON-encoded payload', async () => {
    const response = { transformToString: () => Promise.resolve('{}') } as never;
    bedrockMock
      .on(InvokeAgentRuntimeCommand)
      .resolves({ contentType: 'text/event-stream', statusCode: 200, response });

    const result = await invoker.invoke({
      sessionId: 'job-1-sync',
      payload: { jobId: 'job-1', mode: 'sync' },
      accept: 'text/event-stream',
    });

    expect(result.contentType).toBe('text/event-stream');
    expect(result.statusCode).toBe(200);
    expect(result.response).toBe(response);

    const calls = bedrockMock.commandCalls(InvokeAgentRuntimeCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]?.args[0].input;
    expect(input?.agentRuntimeArn).toBe(
      'arn:aws:bedrock-agentcore:us-east-1:1:runtime/orchestrator',
    );
    expect(input?.runtimeSessionId).toBe('job-1-sync');
    expect(input?.contentType).toBe('application/json');
    expect(input?.accept).toBe('text/event-stream');
    expect(new TextDecoder().decode(input?.payload as Uint8Array)).toBe(
      JSON.stringify({ jobId: 'job-1', mode: 'sync' }),
    );
  });

  it('propagates a rejection from the client', async () => {
    bedrockMock.on(InvokeAgentRuntimeCommand).rejects(new Error('runtime unavailable'));
    await expect(
      invoker.invoke({
        sessionId: 'job-1-async',
        payload: { jobId: 'job-1' },
        accept: 'application/json',
      }),
    ).rejects.toThrow('runtime unavailable');
  });
});
