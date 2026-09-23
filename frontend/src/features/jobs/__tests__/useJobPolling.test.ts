import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listJobs } from '../../../lib/api';
import { useJobPolling } from '../useJobPolling';
import { makeJob } from '../../../tests/fixtures/job';

vi.mock('../../../lib/api', () => ({
  listJobs: vi.fn(),
}));

const listJobsMock = vi.mocked(listJobs);

// Fake timers replace setTimeout but not the microtask queue, so
// `advanceTimersByTimeAsync(0)` is used purely to flush the in-flight
// fetchJobs() promise from the initial mount (waitFor's polling doesn't mix
// well with fake timers, so we flush explicitly instead).
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useJobPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listJobsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches jobs on mount and exposes them', async () => {
    listJobsMock.mockResolvedValue({ items: [makeJob()] });
    const { result } = renderHook(() => useJobPolling());
    await flush();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.jobs).toHaveLength(1);
    expect(listJobsMock).toHaveBeenCalledTimes(1);
  });

  it('polls again after 3s while a job is still active', async () => {
    listJobsMock.mockResolvedValue({ items: [makeJob({ status: 'PROCESSING' })] });
    renderHook(() => useJobPolling());
    await flush();
    expect(listJobsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(listJobsMock).toHaveBeenCalledTimes(2);
  });

  it('slows down to 15s once every job is terminal', async () => {
    listJobsMock.mockResolvedValue({ items: [makeJob({ status: 'COMPLETED' })] });
    renderHook(() => useJobPolling());
    await flush();
    expect(listJobsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(listJobsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(listJobsMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a readable error message and keeps polling at the current interval', async () => {
    listJobsMock.mockRejectedValueOnce(new Error('network down'));
    listJobsMock.mockResolvedValueOnce({ items: [] });
    const { result } = renderHook(() => useJobPolling());
    await flush();
    expect(result.current.error).toBe('network down');

    // A failed fetch must not force the idle (15s) interval: jobs may still
    // be PROCESSING and a slow fallback would stall the UI. The hook keeps
    // whatever interval was last known (the 3s active default here).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(result.current.error).toBeNull();
    expect(listJobsMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale response that resolves after a newer one was already applied', async () => {
    let resolveFirst!: (value: { items: ReturnType<typeof makeJob>[] }) => void;
    const firstResponse = new Promise<{ items: ReturnType<typeof makeJob>[] }>((resolve) => {
      resolveFirst = resolve;
    });
    listJobsMock.mockReturnValueOnce(firstResponse);
    listJobsMock.mockResolvedValueOnce({ items: [makeJob({ jobId: 'newer' })] });

    const { result } = renderHook(() => useJobPolling());
    // The initial mount fetch is now in flight and deliberately left
    // unresolved; a manual refresh() races ahead of it and applies first.
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.jobs.map((job) => job.jobId)).toEqual(['newer']);

    // The slow initial request resolves last, with stale data; it must not
    // clobber the newer state that refresh() already applied.
    await act(async () => {
      resolveFirst({ items: [makeJob({ jobId: 'older' })] });
      await Promise.resolve();
    });
    expect(result.current.jobs.map((job) => job.jobId)).toEqual(['newer']);
  });

  it('refresh() triggers an immediate re-fetch', async () => {
    listJobsMock.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useJobPolling());
    await flush();
    expect(listJobsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(listJobsMock).toHaveBeenCalledTimes(2);
  });
});
