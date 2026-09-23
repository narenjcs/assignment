import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { API_ERROR_CODES, ApiError } from '../../lib/errors';
import { chat } from '../../lib/api';
import type { SseEvent } from '../../types/sse';

export type ChatRole = 'user' | 'assistant' | 'note' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

export interface UseChatStreamResult {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
}

function makeId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`;
}

function noteFor(event: Extract<SseEvent, { type: 'status' | 'tool' }>): string {
  if (event.type === 'status') return event.message ?? `Status: ${event.status}`;
  return event.summary ? `${event.name}: ${event.summary}` : event.name;
}

/** Folds one SSE frame from /chat into the message list (streaming pipeline, no buffering). */
function applyEvent(
  event: SseEvent,
  assistantId: string,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
): void {
  switch (event.type) {
    case 'status':
    case 'tool':
      setMessages((prev) => [...prev, { id: makeId(), role: 'note', text: noteFor(event) }]);
      return;
    case 'token':
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId ? { ...message, text: message.text + event.text } : message,
        ),
      );
      return;
    case 'result':
    case 'error':
    case 'done':
      return;
  }
}

interface RunChatTurnParams {
  jobId: string;
  message: string;
  assistantId: string;
  signal: AbortSignal;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setError: (message: string | null) => void;
}

/** Streams one /chat turn; an abort from a jobId change or unmount is not a user-facing failure. */
async function runChatTurn(params: RunChatTurnParams): Promise<void> {
  const { jobId, message, assistantId, signal, setMessages, setError } = params;
  try {
    await chat(
      jobId,
      message,
      (event) => {
        if (event.type === 'error') setError(event.error.message);
        applyEvent(event, assistantId, setMessages);
      },
      { signal },
    );
  } catch (err) {
    if (err instanceof ApiError && err.code === API_ERROR_CODES.ABORTED) return;
    setError(err instanceof Error ? err.message : 'Chat failed');
  }
}

/** Streams a chat turn for a completed job's /chat SSE endpoint (PLAN §2.6). */
export function useChatStream(jobId: string | null): UseChatStreamResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A stream tied to the previous job must not keep writing into this job's
  // message list, and a stale job's messages/errors have no business showing
  // once the selection changes.
  useEffect(() => {
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [jobId]);

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!jobId || !trimmed || isStreaming) return;

      setError(null);
      setIsStreaming(true);
      const assistantId = makeId();
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: 'user', text: trimmed },
        { id: assistantId, role: 'assistant', text: '' },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;
      await runChatTurn({
        jobId,
        message: trimmed,
        assistantId,
        signal: controller.signal,
        setMessages,
        setError,
      });
      if (abortRef.current === controller) abortRef.current = null;
      setIsStreaming(false);
    },
    [jobId, isStreaming],
  );

  return { messages, isStreaming, error, sendMessage };
}
