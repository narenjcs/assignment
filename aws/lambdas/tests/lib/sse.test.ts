import { describe, expect, it } from 'vitest';
import { frame, heartbeat, parseSseChunk } from '../../src/lib/sse.js';
import type { SseEvent } from '../../src/lib/types.js';

describe('frame', () => {
  it('formats a data frame terminated by a blank line', () => {
    const event: SseEvent = { type: 'status', ts: '2026-01-01T00:00:00.000Z', message: 'hi' };
    expect(frame(event)).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });
});

describe('heartbeat', () => {
  it('is an SSE comment line', () => {
    expect(heartbeat()).toBe(': ping\n\n');
  });
});

describe('parseSseChunk', () => {
  it('parses a single complete frame with no remainder', () => {
    const event: SseEvent = { type: 'token', ts: 't', text: 'hi' };
    const { events, remainder } = parseSseChunk(frame(event));
    expect(events).toEqual([event]);
    expect(remainder).toBe('');
  });

  it('parses multiple complete frames in one chunk', () => {
    const a: SseEvent = { type: 'status', ts: 't1' };
    const b: SseEvent = { type: 'done', ts: 't2' };
    const { events, remainder } = parseSseChunk(frame(a) + frame(b));
    expect(events).toEqual([a, b]);
    expect(remainder).toBe('');
  });

  it('keeps a trailing partial frame as the remainder', () => {
    const a: SseEvent = { type: 'status', ts: 't1' };
    const partial = 'data: {"type":"token"';
    const { events, remainder } = parseSseChunk(frame(a) + partial);
    expect(events).toEqual([a]);
    expect(remainder).toBe(partial);
  });

  it('ignores heartbeat comment lines that have no data: line', () => {
    const a: SseEvent = { type: 'status', ts: 't1' };
    const { events } = parseSseChunk(heartbeat() + frame(a));
    expect(events).toEqual([a]);
  });

  it('returns no events and an empty remainder for an empty chunk', () => {
    const { events, remainder } = parseSseChunk('');
    expect(events).toEqual([]);
    expect(remainder).toBe('');
  });
});
