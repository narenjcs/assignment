import type { SseEvent } from './types.js';

/** Formats an SSE data frame: `data: <json>\n\n` (DEVELOPMENT.md §10). */
export function frame(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** SSE keep-alive comment line, sent every 15s while an upstream stream is quiet. */
export function heartbeat(): string {
  return ': ping\n\n';
}

export interface ParsedSseChunk {
  events: SseEvent[];
  remainder: string;
}

/**
 * Parses a raw SSE text chunk (possibly partial) into complete `data:` events plus any
 * trailing partial frame, for tests and for the chat/process stream re-parsers.
 */
export function parseSseChunk(chunk: string): ParsedSseChunk {
  const parts = chunk.split('\n\n');
  const remainder = parts.pop() ?? '';
  const events: SseEvent[] = [];
  for (const part of parts) {
    const dataLine = part.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) {
      continue;
    }
    const json = dataLine.slice('data:'.length).trim();
    events.push(JSON.parse(json) as SseEvent);
  }
  return { events, remainder };
}
