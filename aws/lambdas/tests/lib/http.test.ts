import { describe, expect, it, vi } from 'vitest';
import { withRetry, withTimeout } from '../../src/lib/http.js';

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { attempts: 3, backoffMs: 1, jitter: false });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success within the attempt budget', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom-1'))
      .mockRejectedValueOnce(new Error('boom-2'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { attempts: 5, backoffMs: 1, jitter: false });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error once attempts are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { attempts: 2, backoffMs: 1, jitter: false })).rejects.toThrow(
      'always fails',
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops retrying immediately when retryOn returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));
    const retryOn = vi.fn().mockReturnValue(false);
    await expect(
      withRetry(fn, { attempts: 5, backoffMs: 1, jitter: false, retryOn }),
    ).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('applies jittered backoff without throwing', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { attempts: 2, backoffMs: 1, jitter: true });
    expect(result).toBe('ok');
  });
});

describe('withTimeout', () => {
  it('resolves when the promise settles before the deadline', async () => {
    const result = await withTimeout(Promise.resolve('fast'), 50);
    expect(result).toBe('fast');
  });

  it('rejects when the promise does not settle in time', async () => {
    const never = new Promise<string>(() => {
      // never resolves
    });
    await expect(withTimeout(never, 10)).rejects.toThrow(/timed out/);
  });

  it('propagates the original rejection when the promise rejects first', async () => {
    await expect(withTimeout(Promise.reject(new Error('inner failure')), 50)).rejects.toThrow(
      'inner failure',
    );
  });
});
