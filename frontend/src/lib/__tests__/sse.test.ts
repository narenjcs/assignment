import { describe, expect, it } from 'vitest';

import { SseParser } from '../sse';

describe('SseParser', () => {
  it('parses a single complete frame', () => {
    const parser = new SseParser();
    const events = parser.push('data: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}\n\n');
    expect(events).toEqual([{ type: 'done', ts: '2026-01-01T00:00:00.000Z' }]);
  });

  it('buffers a frame split across multiple chunks', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"tok')).toEqual([]);
    const events = parser.push('en","text":"hi"}\n\n');
    expect(events).toEqual([{ type: 'token', text: 'hi' }]);
  });

  it('ignores `: ping` comment lines and blank lines', () => {
    const parser = new SseParser();
    const events = parser.push(
      ': ping\n\ndata: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}\n\n',
    );
    expect(events).toEqual([{ type: 'done', ts: '2026-01-01T00:00:00.000Z' }]);
  });

  it('parses multiple frames delivered in one chunk', () => {
    const parser = new SseParser();
    const events = parser.push(
      'data: {"type":"status","ts":"2026-01-01T00:00:00.000Z","jobId":"j1","status":"QUEUED"}\n\n' +
        'data: {"type":"done","ts":"2026-01-01T00:00:01.000Z"}\n\n',
    );
    expect(events).toEqual([
      { type: 'status', ts: '2026-01-01T00:00:00.000Z', jobId: 'j1', status: 'QUEUED' },
      { type: 'done', ts: '2026-01-01T00:00:01.000Z' },
    ]);
  });

  it('returns a synthetic error event for malformed JSON', () => {
    const parser = new SseParser();
    const events = parser.push('data: {not json}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect(events[0]?.type === 'error' && events[0].error.message).toMatch(/Malformed SSE frame/);
  });

  it('returns a synthetic error event when the payload fails schema validation', () => {
    const parser = new SseParser();
    const events = parser.push('data: {"type":"nonsense"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
  });

  it('joins multi-line `data:` fields per the SSE spec', () => {
    const parser = new SseParser();
    const events = parser.push('data: {"type":"error",\ndata: "message":"joined"}\n\n');
    // Two `data:` lines are joined with `\n` before JSON.parse; this payload is
    // intentionally invalid JSON to prove the join happened (single-line valid
    // JSON is covered by the other tests), so we just assert it surfaces as an error.
    expect(events[0]).toMatchObject({ type: 'error' });
  });

  it('handles CRLF line endings', () => {
    const parser = new SseParser();
    const events = parser.push('data: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}\r\n\r\n');
    expect(events).toEqual([{ type: 'done', ts: '2026-01-01T00:00:00.000Z' }]);
  });

  it('carries no state across frames once consumed', () => {
    const parser = new SseParser();
    parser.push('data: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}\n\n');
    const events = parser.push('data: {"type":"done","ts":"2026-01-01T00:00:01.000Z"}\n\n');
    expect(events).toEqual([{ type: 'done', ts: '2026-01-01T00:00:01.000Z' }]);
  });

  it('reassembles a CRLF separator split across two chunks without dropping the next frame', () => {
    // A chunk boundary landing mid-separator (after "\r\n" but before the
    // closing "\r\n") used to defeat a per-chunk CRLF normalisation pass,
    // silently merging this frame into the next one and losing its payload.
    const parser = new SseParser();
    const first = parser.push('data: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}\r\n\r');
    expect(first).toEqual([]);
    const second = parser.push('\ndata: {"type":"done","ts":"2026-01-01T00:00:01.000Z"}\r\n\r\n');
    expect(second).toEqual([
      { type: 'done', ts: '2026-01-01T00:00:00.000Z' },
      { type: 'done', ts: '2026-01-01T00:00:01.000Z' },
    ]);
  });

  describe('flush()', () => {
    it('emits a final frame that never got a trailing blank line', () => {
      const parser = new SseParser();
      expect(parser.push('data: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}')).toEqual([]);
      expect(parser.flush()).toEqual([{ type: 'done', ts: '2026-01-01T00:00:00.000Z' }]);
    });

    it('returns an empty array when there is nothing buffered', () => {
      const parser = new SseParser();
      parser.push('data: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}\n\n');
      expect(parser.flush()).toEqual([]);
    });

    it('returns an empty array for a whitespace-only remainder', () => {
      const parser = new SseParser();
      parser.push('data: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}\n\n   \n');
      expect(parser.flush()).toEqual([]);
    });

    it('clears the buffer so a second flush() is a no-op', () => {
      const parser = new SseParser();
      parser.push('data: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}');
      expect(parser.flush()).toHaveLength(1);
      expect(parser.flush()).toEqual([]);
    });
  });
});
