import { useCallback, useEffect, useRef, useState } from 'react';

import { listJobs } from '../../lib/api';
import { isTerminalStatus, type Job } from '../../types/job';

export interface UseJobPollingResult {
  jobs: Job[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// Poll fast while something is still moving, and slow down once every job has
// reached a terminal state (DEVELOPMENT.md/TASKS.md T7.3: 3s while active, 15s otherwise).
const ACTIVE_INTERVAL_MS = 3_000;
const IDLE_INTERVAL_MS = 15_000;

function nextDelay(jobs: Job[]): number {
  return jobs.some((job) => !isTerminalStatus(job.status)) ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
}

/** Polls GET /jobs on a self-adjusting interval and exposes a manual refresh(). */
export function useJobPolling(): UseJobPollingResult {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The scheduled poll tick and a manual refresh() can both be in flight at
  // once; a slower, older request must not clobber a faster, newer one that
  // already applied its result. requestSeq is bumped per request start,
  // appliedSeq tracks the seq of the last response actually applied.
  const requestSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);
  // Jobs may still be PROCESSING even when a poll happens to fail (e.g. a
  // transient network blip); an error should not reset the cadence back to
  // the idle interval, since that would slow down polling for active jobs.
  const lastDelayRef = useRef(ACTIVE_INTERVAL_MS);

  const fetchJobs = useCallback(async (): Promise<number> => {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    try {
      const response = await listJobs();
      if (seq < appliedSeqRef.current) return lastDelayRef.current;
      appliedSeqRef.current = seq;
      setJobs(response.items);
      setError(null);
      lastDelayRef.current = nextDelay(response.items);
      return lastDelayRef.current;
    } catch (err) {
      if (seq < appliedSeqRef.current) return lastDelayRef.current;
      appliedSeqRef.current = seq;
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
      return lastDelayRef.current;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      const delay = await fetchJobs();
      if (cancelled) return;
      timer = setTimeout(() => void tick(), delay);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchJobs]);

  const refresh = useCallback(async () => {
    await fetchJobs();
  }, [fetchJobs]);

  return { jobs, isLoading, error, refresh };
}
