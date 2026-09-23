import type { ReactElement } from 'react';

import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Stepper } from '../../components/Stepper';
import type { Job } from '../../types/job';
import { JobResultCard } from './JobResultCard';
import { JobTrace } from './JobTrace';

export interface JobDetailProps {
  job: Job | null;
}

/** Detail panel for the selected job: status, progress, agent trace, results. */
export function JobDetail({ job }: JobDetailProps): ReactElement {
  if (!job) {
    return (
      <Card title="Job detail">
        <EmptyState
          title="No job selected"
          description="Pick a job from the list, or upload a new document."
        />
      </Card>
    );
  }

  return (
    <Card title={job.fileName}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <Badge variant="status" status={job.status}>
          {job.status}
        </Badge>
        <span className="capitalize">{job.mode} mode</span>
        {job.processor && <span>· {job.processor}</span>}
      </div>

      <Stepper status={job.status} />

      {job.error !== undefined && (
        <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">
          {job.error}
        </p>
      )}

      <section className="mt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Agent trace
        </h3>
        <JobTrace events={job.events} />
      </section>

      <section className="mt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Results
        </h3>
        {job.result ? (
          <JobResultCard result={job.result} />
        ) : (
          <EmptyState title="No results yet" description="Results appear once the job completes." />
        )}
      </section>
    </Card>
  );
}
