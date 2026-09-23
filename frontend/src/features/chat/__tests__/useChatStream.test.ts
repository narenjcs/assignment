import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chat } from '../../../lib/api';
import type { SseEvent } from '../../../types/sse';
import { useChatStream, type UseChatStreamResult } from '../useChatStream';

vi.mock('../../../lib/api', () => ({
  chat: vi.fn(),
}));

const chatMock = vi.mocked(chat);

describe('useChatStream', () => {
  afterEach(() => vi.resetAllMocks());

  it('does nothing when jobId is null', async () => {
    const { result } = renderHook(() => useChatStream(null));
    await act(async () => {
      await result.current.sendMessage('hello');
    });
    expect(chatMock).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it('ignores blank messages', async () => {
    const { result } = renderHook(() => useChatStream('j1'));
    await act(async () => {
      await result.current.sendMessage('   ');
    });
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('adds a user turn and streams tokens into the assistant reply', async () => {
    chatMock.mockImplementation((_jobId, _message, onEvent: (event: SseEvent) => void) => {
      onEvent({ type: 'token', text: 'Hi' });
      onEvent({ type: 'token', text: ' there' });
      onEvent({ type: 'done', ts: '2026-01-01T00:00:00.000Z' });
      return Promise.resolve();
    });

    const { result } = renderHook(() => useChatStream('j1'));
    await act(async () => {
      await result.current.sendMessage('hello');
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', text: 'hello' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', text: 'Hi there' });
  });

  it('adds status and tool frames as inline notes', async () => {
    chatMock.mockImplementation((_jobId, _message, onEvent: (event: SseEvent) => void) => {
      onEvent({
        type: 'status',
        ts: '2026-01-01T00:00:00.000Z',
        jobId: 'j1',
        status: 'PROCESSING',
        message: 'Thinking',
      });
      onEvent({
        type: 'tool',
        ts: '2026-01-01T00:00:00.000Z',
        jobId: 'j1',
        source: 'aws',
        name: 'search_docs',
        phase: 'start',
      });
      onEvent({ type: 'done', ts: '2026-01-01T00:00:01.000Z' });
      return Promise.resolve();
    });

    const { result } = renderHook(() => useChatStream('j1'));
    await act(async () => {
      await result.current.sendMessage('hello');
    });

    const notes = result.current.messages.filter((message) => message.role === 'note');
    expect(notes).toHaveLength(2);
    expect(notes[0]?.text).toBe('Thinking');
    expect(notes[1]?.text).toBe('search_docs');
  });

  it('surfaces an error frame via the error field', async () => {
    chatMock.mockImplementation((_jobId, _message, onEvent: (event: SseEvent) => void) => {
      onEvent({
        type: 'error',
        ts: '2026-01-01T00:00:00.000Z',
        error: { code: 'UPSTREAM_FAILURE', message: 'upstream failure' },
      });
      return Promise.resolve();
    });

    const { result } = renderHook(() => useChatStream('j1'));
    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(result.current.error).toBe('upstream failure');
  });

  it('surfaces a rejected chat() call as an error and resets isStreaming', async () => {
    chatMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useChatStream('j1'));
    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(result.current.error).toBe('network down');
    expect(result.current.isStreaming).toBe(false);
  });

  it('resets messages and error when jobId changes', async () => {
    chatMock.mockImplementation((_jobId, _message, onEvent: (event: SseEvent) => void) => {
      onEvent({
        type: 'error',
        ts: '2026-01-01T00:00:00.000Z',
        error: { code: 'X', message: 'boom' },
      });
      return Promise.resolve();
    });

    const { result, rerender } = renderHook<UseChatStreamResult, { jobId: string | null }>(
      ({ jobId }) => useChatStream(jobId),
      { initialProps: { jobId: 'j1' } },
    );
    await act(async () => {
      await result.current.sendMessage('hello');
    });
    expect(result.current.messages.length).toBeGreaterThan(0);
    expect(result.current.error).toBe('boom');

    rerender({ jobId: 'j2' });
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('aborts the in-flight stream when jobId changes', async () => {
    let capturedSignal: AbortSignal | undefined;
    chatMock.mockImplementation(
      (
        _jobId,
        _message,
        _onEvent: (event: SseEvent) => void,
        options?: { signal?: AbortSignal },
      ) => {
        capturedSignal = options?.signal;
        return new Promise<void>(() => {
          // Never resolves: simulates a stream still in flight.
        });
      },
    );

    const { result, rerender } = renderHook<UseChatStreamResult, { jobId: string | null }>(
      ({ jobId }) => useChatStream(jobId),
      { initialProps: { jobId: 'j1' } },
    );
    act(() => {
      void result.current.sendMessage('hello');
    });
    await waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);

    rerender({ jobId: 'j2' });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('aborts the in-flight stream on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    chatMock.mockImplementation(
      (
        _jobId,
        _message,
        _onEvent: (event: SseEvent) => void,
        options?: { signal?: AbortSignal },
      ) => {
        capturedSignal = options?.signal;
        return new Promise<void>(() => {
          // Never resolves: simulates a stream still in flight.
        });
      },
    );

    const { result, unmount } = renderHook(() => useChatStream('j1'));
    act(() => {
      void result.current.sendMessage('hello');
    });
    await waitFor(() => expect(capturedSignal).toBeDefined());

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
