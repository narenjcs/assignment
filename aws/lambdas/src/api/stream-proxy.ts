import type { Writable } from 'node:stream';
import type { AgentCoreInvoker, InvokeInput } from '../lib/agentcore.js';
import { frame, heartbeat, parseSseChunk } from '../lib/sse.js';
import type { SseEvent } from '../lib/types.js';

const HEARTBEAT_MS = 15_000;

function chunkToText(chunk: unknown): string {
  if (typeof chunk === 'string') {
    return chunk;
  }
  return Buffer.from(chunk as Uint8Array).toString('utf-8');
}

function errorFrame(error: unknown, jobId: string): string {
  const message = error instanceof Error ? error.message : 'Upstream error';
  const event: SseEvent = {
    type: 'error',
    ts: new Date().toISOString(),
    jobId,
    error: { code: 'UPSTREAM_ERROR', message },
  };
  return frame(event);
}

function doneFrame(jobId: string): string {
  return frame({ type: 'done', ts: new Date().toISOString(), jobId });
}

/**
 * Invokes the orchestrator and pipes its SSE byte stream straight to `out` without
 * buffering (DEVELOPMENT.md §9 "Streaming pipeline"). Sends a `: ping` heartbeat every 15s —
 * only while the buffer sits at a clean frame boundary, so a heartbeat can never be written
 * in the middle of a split `data:` frame — and guarantees the response always ends with
 * exactly one `done` frame, detected by parsing frames (not substring-matching, since the
 * orchestrator's JSON whitespace is not guaranteed to match any fixed marker).
 */
export async function proxyAgentCoreStream(
  agentCore: AgentCoreInvoker,
  invokeInput: InvokeInput,
  out: Writable,
  jobId: string,
): Promise<void> {
  let atFrameBoundary = true;
  const heartbeatTimer = setInterval(() => {
    if (atFrameBoundary) {
      out.write(heartbeat());
    }
  }, HEARTBEAT_MS);
  let sawDone = false;
  let buffer = '';
  try {
    const result = await agentCore.invoke(invokeInput);
    if (result.response) {
      for await (const chunk of result.response as unknown as AsyncIterable<unknown>) {
        const text = chunkToText(chunk);
        out.write(text);
        buffer += text;
        const { events, remainder } = parseSseChunk(buffer);
        buffer = remainder;
        atFrameBoundary = remainder.length === 0;
        sawDone ||= events.some((event) => event.type === 'done');
      }
    }
  } catch (error) {
    out.write(errorFrame(error, jobId));
  } finally {
    clearInterval(heartbeatTimer);
    if (!sawDone) {
      out.write(doneFrame(jobId));
    }
    out.end();
  }
}
