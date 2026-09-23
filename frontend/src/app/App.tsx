import { useCallback, useMemo, useState, type ReactElement } from 'react';

import { Badge } from '../components/Badge';
import { ChatPanel } from '../features/chat/ChatPanel';
import { JobDetail } from '../features/jobs/JobDetail';
import { JobsList } from '../features/jobs/JobsList';
import { useJobPolling } from '../features/jobs/useJobPolling';
import { UploadPanel } from '../features/upload/UploadPanel';

/** Two-column DocIntel shell: upload + jobs on the left, detail + chat on the right. */
export function App(): ReactElement {
  const { jobs, isLoading, error, refresh } = useJobPolling();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const selectedJob = useMemo(
    () => jobs.find((job) => job.jobId === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const handleJobCreated = useCallback(
    (jobId: string) => {
      setSelectedJobId(jobId);
      void refresh();
    },
    [refresh],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">DocIntel</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Cross-cloud agentic document intelligence
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="aws">AWS</Badge>
          <Badge variant="databricks">Databricks</Badge>
          <Badge variant="orchestrator">Orchestrator</Badge>
        </div>
      </header>

      <main className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <UploadPanel onJobCreated={handleJobCreated} onResync={() => void refresh()} />
          <JobsList
            jobs={jobs}
            selectedJobId={selectedJobId}
            isLoading={isLoading}
            error={error}
            onSelect={setSelectedJobId}
          />
        </div>
        <div className="space-y-6">
          <JobDetail job={selectedJob} />
          <ChatPanel job={selectedJob} />
        </div>
      </main>
    </div>
  );
}
