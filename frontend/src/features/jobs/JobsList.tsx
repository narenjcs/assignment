import type { ReactElement } from 'react';

import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Spinner } from '../../components/Spinner';
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
 * Presentational list of jobs. Data comes from useJobPolling (owned by the
 * app composition root), which polls GET /jobs every 3s while any job is
 * non-terminal and every 15s once all jobs are terminal.
 */
export function JobsList({
  jobs,
  selectedJobId,
  isLoading,
  error,
  onSelect,
}: JobsListProps): ReactElement {
  return (
    <Card title="Jobs">
      {error && (
        <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {isLoading && jobs.length === 0 && <Spinner label="Loading jobs" />}
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
    </Card>
  );
}
