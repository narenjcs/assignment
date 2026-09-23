import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { proxyAgentCoreStream } from '../../src/api/stream-proxy.js';
import type { AgentCoreInvoker, InvokeInput, InvokeResult } from '../../src/lib/agentcore.js';

const INVOKE_INPUT: InvokeInput = {
  sessionId: 'job-1-sync',
  payload: { jobId: 'job-1', mode: 'sync' },
  accept: 'text/event-stream',
};

function asyncIterableOf(chunks: string[]): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]: () => {
      let i = 0;
      return {
        next: () =>
          Promise.resolve(
            i < chunks.length
              ? { value: chunks[i++], done: false }
              : { value: undefined, done: true },
          ),
      };
    },
  };
}

describe('proxyAgentCoreStream', () => {
  it('forwards each upstream chunk and always ends the stream', async () => {
    const response = asyncIterableOf(['data: {"type":"token"}\n\n', 'data: {"type":"done"}\n\n']);
    const invoker: AgentCoreInvoker = {
      invoke: vi.fn((): Promise<InvokeResult> =>
        Promise.resolve({
          contentType: 'text/event-stream',
          statusCode: 200,
          response: response as unknown as InvokeResult['response'],
        }),
      ),
    };
    const out = new PassThrough();
    const written: string[] = [];
    out.on('data', (chunk: Buffer) => written.push(chunk.toString('utf-8')));

    await proxyAgentCoreStream(invoker, INVOKE_INPUT, out, 'job-1');

    expect(invoker.invoke).toHaveBeenCalledWith(INVOKE_INPUT);
    const text = written.join('');
    expect(text).toContain('"type":"token"');
    expect(text).toContain('"type":"done"');
    expect(out.writableEnded).toBe(true);
  });

  it('emits a trailing done frame when the upstream never sends one', async () => {
    const response = asyncIterableOf(['data: {"type":"token"}\n\n']);
    const invoker: AgentCoreInvoker = {
      invoke: () =>
        Promise.resolve({
          contentType: 'text/event-stream',
          statusCode: 200,
          response: response as unknown as InvokeResult['response'],
        }),
    };
    const out = new PassThrough();
    const written: string[] = [];
    out.on('data', (chunk: Buffer) => written.push(chunk.toString('utf-8')));

    await proxyAgentCoreStream(invoker, INVOKE_INPUT, out, 'job-1');

    const text = written.join('');
    expect(text).toContain('"type":"done"');
    expect(text).toContain('"jobId":"job-1"');
    expect(out.writableEnded).toBe(true);
  });

  it('writes an error frame then a done frame when the upstream invoke rejects', async () => {
    const invoker: AgentCoreInvoker = {
      invoke: () => Promise.reject(new Error('runtime unavailable')),
    };
    const out = new PassThrough();
    const written: string[] = [];
    out.on('data', (chunk: Buffer) => written.push(chunk.toString('utf-8')));

    await proxyAgentCoreStream(invoker, INVOKE_INPUT, out, 'job-1');

    const text = written.join('');
    expect(text).toContain('"type":"error"');
    expect(text).toContain('runtime unavailable');
    expect(text).toContain('"jobId":"job-1"');
    expect(text).toContain('"type":"done"');
    expect(out.writableEnded).toBe(true);
  });

  it('never writes a heartbeat in the middle of a split SSE frame', async () => {
    vi.useFakeTimers();
    try {
      let resumeSecondHalf: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        resumeSecondHalf = resolve;
      });
      const response: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]: () => {
          let i = 0;
          return {
            next: async () => {
              if (i === 0) {
                i++;
                return { value: 'data: {"typ', done: false };
              }
              if (i === 1) {
                i++;
                await gate;
                return { value: 'e":"token"}\n\n', done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };
      const invoker: AgentCoreInvoker = {
        invoke: (): Promise<InvokeResult> =>
          Promise.resolve({
            contentType: 'text/event-stream',
            statusCode: 200,
            response: response as unknown as InvokeResult['response'],
          }),
      };
      const out = new PassThrough();
      const writes: string[] = [];
      out.on('data', (chunk: Buffer) => writes.push(chunk.toString('utf-8')));

      const donePromise = proxyAgentCoreStream(invoker, INVOKE_INPUT, out, 'job-1');

      // Let the first (partial) chunk land — the buffer is now mid-frame.
      await vi.advanceTimersByTimeAsync(0);
      // Fire the 15s heartbeat interval while still mid-frame: it must be suppressed.
      await vi.advanceTimersByTimeAsync(15_000);
      resumeSecondHalf();
      await donePromise;

      const firstIdx = writes.findIndex((w) => w.includes('data: {"typ'));
      const secondIdx = writes.findIndex((w) => w.includes('e":"token"}'));
      expect(firstIdx).toBeGreaterThanOrEqual(0);
      expect(secondIdx).toBeGreaterThan(firstIdx);
      const between = writes.slice(firstIdx + 1, secondIdx);
      expect(between.every((w) => !w.includes(': ping'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not emit an extra done frame when the response has no body at all', async () => {
    const invoker: AgentCoreInvoker = {
      invoke: () =>
        Promise.resolve({ contentType: undefined, statusCode: 200, response: undefined }),
    };
    const out = new PassThrough();
    const written: string[] = [];
    out.on('data', (chunk: Buffer) => written.push(chunk.toString('utf-8')));

    await proxyAgentCoreStream(invoker, INVOKE_INPUT, out, 'job-1');

    expect(written.join('')).toContain('"type":"done"');
    expect(written.join('')).toContain('"jobId":"job-1"');
    expect(out.writableEnded).toBe(true);
  });
});
