import { makeSseError, SseEventSchema, type SseEvent } from '../types/sse';

// Incremental parser for the SSE contract in docs/PLAN.md §2.6: frames are
// `data: <json>\r?\n\r?\n`, a `: ping` comment line keeps proxies alive, and
// `done` is always the terminal frame. Built to be fed raw text chunks as
// they arrive from a fetch() ReadableStream, one instance per stream.

// The blank-line frame separator, tolerant of LF or CRLF line endings. Matched
// against the *accumulated* buffer (not each chunk) so a separator split
// across two chunks is still found once both halves have arrived.
const FRAME_SEPARATOR_RE = /\r?\n\r?\n/;

function extractDataPayload(frameText: string): string | null {
  const dataLines: string[] = [];
  for (const rawLine of frameText.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '' || line.startsWith(':')) continue; // blank line / `: ping` comment
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    // Other SSE fields (event:, id:, retry:) are not part of this contract and are ignored.
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

function toSseEvent(raw: string): SseEvent {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return makeSseError(`Malformed SSE frame: invalid JSON (${raw.slice(0, 80)})`);
  }
  const result = SseEventSchema.safeParse(parsedJson);
  if (!result.success) {
    const reason = result.error.issues[0]?.message ?? 'schema mismatch';
    return makeSseError(`Malformed SSE frame: ${reason}`);
  }
  return result.data;
}

function parseFrame(frameText: string): SseEvent | null {
  const payload = extractDataPayload(frameText);
  return payload === null ? null : toSseEvent(payload);
}

export class SseParser {
  private buffer = '';

  /** Feeds a raw text chunk in and returns every event completed by it. */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let match = FRAME_SEPARATOR_RE.exec(this.buffer);
    while (match) {
      const frameText = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const event = parseFrame(frameText);
      if (event) events.push(event);
      match = FRAME_SEPARATOR_RE.exec(this.buffer);
    }
    return events;
  }

  /**
   * Emits whatever is left in the buffer as a final frame, for a stream that
   * hit EOF without a trailing blank line (SSE spec: EOF terminates the last
   * event). Safe to call on an empty/whitespace-only buffer.
   */
  flush(): SseEvent[] {
    const remainder = this.buffer;
    this.buffer = '';
    if (remainder.trim() === '') return [];
    const event = parseFrame(remainder);
    return event ? [event] : [];
  }
}
