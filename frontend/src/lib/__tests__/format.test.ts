import { describe, expect, it } from 'vitest';

import { formatBytes, formatRelativeTime } from '../format';

describe('formatBytes', () => {
  it('formats zero and negative values as 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });

  it('formats bytes below 1KB with no decimal', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes, megabytes, and gigabytes with one decimal', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-01-01T00:10:00.000Z');

  it('returns "just now" for very recent timestamps', () => {
    expect(formatRelativeTime('2026-01-01T00:09:58.000Z', now)).toBe('just now');
  });

  it('formats seconds, minutes, hours, and days ago', () => {
    expect(formatRelativeTime('2026-01-01T00:09:30.000Z', now)).toBe('30s ago');
    expect(formatRelativeTime('2026-01-01T00:05:00.000Z', now)).toBe('5m ago');
    expect(formatRelativeTime('2025-12-31T22:10:00.000Z', now)).toBe('2h ago');
    expect(formatRelativeTime('2025-12-28T00:10:00.000Z', now)).toBe('4d ago');
  });

  it('returns the raw string for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('not-a-date');
  });
});
