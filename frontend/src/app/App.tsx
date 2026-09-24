import { useCallback, useMemo, useState, type ReactElement } from 'react';

import { ChatPanel } from '../features/chat/ChatPanel';
import { JobDetail } from '../features/jobs/JobDetail';
import { JobsList } from '../features/jobs/JobsList';
import { useJobPolling } from '../features/jobs/useJobPolling';
import { UploadPanel } from '../features/upload/UploadPanel';
import { AppHeader } from './AppHeader';
import { useLiveEvents } from './useLiveEvents';

/**
 * Two-column DocIntel shell: upload + jobs on the left, detail + chat on the right. Each panel
 * owns its own scroll region — a viewport-height shell (`h-dvh`) with `min-h-0` threaded through
 * every flex child — so a long job list or trace never grows the page itself; the header stays
 * put. Mobile stacks the two columns (`grid-rows-2`), each still independently scrollable.
 */
export function App(): ReactElement {
  const { jobs, isLoading, error, refresh } = useJobPolling();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const selectedJob = useMemo(
    () => jobs.find((job) => job.jobId === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const { activeLiveEvents, onJobCreated, onStreamEvent } = useLiveEvents(selectedJob);

  const handleJobCreated = useCallback(
    (jobId: string) => {
      setSelectedJobId(jobId);
      onJobCreated(jobId);
      void refresh();
    },
    [refresh, onJobCreated],
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppHeader />

      <main className="grid min-h-0 flex-1 grid-rows-2 gap-4 overflow-hidden px-4 pb-4 lg:grid-cols-2 lg:grid-rows-1 lg:gap-6">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="shrink-0">
            <UploadPanel
              onJobCreated={handleJobCreated}
              onResync={() => void refresh()}
              onStreamEvent={onStreamEvent}
            />
          </div>
          <div className="min-h-0 flex-1">
            <JobsList
              jobs={jobs}
              selectedJobId={selectedJobId}
              isLoading={isLoading}
              error={error}
              onSelect={setSelectedJobId}
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-4">
          <div className="min-h-0 flex-1">
            <JobDetail job={selectedJob} liveEvents={activeLiveEvents} />
          </div>
          <div className="shrink-0">
            <ChatPanel job={selectedJob} />
          </div>
        </div>
      </main>
    </div>
  );
}
