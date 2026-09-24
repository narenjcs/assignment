import type { ReactElement } from 'react';

import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import type { Job } from '../../types/job';
import { JobRow } from './JobRow';

export interface JobsListProps {
  jobs: Job[];
  selectedJobId: string | null;
  isLoading: boolean;
  error: string | null;
  onSelect: (jobId: string) => void;
}

/**
 * Presentational, independently-scrolling list of jobs (own scroll region so a long list never
 * grows the page). Data comes from useJobPolling (owned by the app composition root), which
 * polls GET /jobs every 3s while any job is non-terminal and every 15s once all jobs are
 * terminal.
 */
export function JobsList({
  jobs,
  selectedJobId,
  isLoading,
  error,
  onSelect,
}: JobsListProps): ReactElement {
  return (
    <Card title="Jobs" className="flex h-full min-h-0 flex-col">
      {error && (
        <p role="alert" className="mb-2 shrink-0 text-xs text-state-failed">
          {error}
        </p>
      )}
      <div className="scroll-panel min-h-0 flex-1 pr-1">
        {isLoading && jobs.length === 0 && (
          <>
            <span role="status" className="sr-only">
              Loading jobs
            </span>
            <Skeleton count={3} />
          </>
        )}
        {!isLoading && jobs.length === 0 && !error && (
          <EmptyState title="No jobs yet" description="Upload a document to get started." />
        )}
        {jobs.length > 0 && (
          <ul className="space-y-1">
            {jobs.map((job) => (
              <JobRow
                key={job.jobId}
                job={job}
                isSelected={job.jobId === selectedJobId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
