import { useCallback, useState } from 'react';

import type { Job } from '../types/job';
import type { SseEvent } from '../types/sse';

export interface LiveEventsController {
  /** Live SSE events for the currently-streaming job, or `[]` once a different job is selected. */
  activeLiveEvents: SseEvent[];
  onJobCreated: (jobId: string) => void;
  onStreamEvent: (event: SseEvent) => void;
}

/** Tracks the live SSE stream for whichever job most recently started uploading, so the flow
 * diagram can reflect a sync upload in progress (UI-PLAN §1: "plus live SSE events in sync
 * mode") without a full page refresh once the job lands in the polled list. */
export function useLiveEvents(selectedJob: Job | null): LiveEventsController {
  const [streamingJobId, setStreamingJobId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<SseEvent[]>([]);

  const onJobCreated = useCallback((jobId: string) => {
    setStreamingJobId(jobId);
    setLiveEvents([]);
  }, []);

  const onStreamEvent = useCallback((event: SseEvent) => {
    setLiveEvents((prev) => [...prev, event]);
  }, []);

  const activeLiveEvents = selectedJob && selectedJob.jobId === streamingJobId ? liveEvents : [];

  return { activeLiveEvents, onJobCreated, onStreamEvent };
}
