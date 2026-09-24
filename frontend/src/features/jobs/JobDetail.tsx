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

/** Detail panel for the selected job: status stepper, result card, agent trace (in that order —
 * the diagram is deferred to a later round). The stepper/status block stays pinned while the
 * result + trace section scrolls under it. */
export function JobDetail({ job }: JobDetailProps): ReactElement {
  if (!job) {
    return (
      <Card title="Job detail" className="flex h-full min-h-0 flex-col">
        <EmptyState
          title="No job selected"
          description="Pick a job from the list, or upload a new document."
        />
      </Card>
    );
  }

  return (
    <Card title={job.fileName} className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <div aria-live="polite" className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <Badge variant="status" status={job.status}>
            {job.status}
          </Badge>
          <span className="capitalize">{job.mode} mode</span>
          {job.processor && <span>· {job.processor}</span>}
        </div>

        <Stepper status={job.status} />

        {job.error !== undefined && (
          <p role="alert" className="mt-3 text-xs text-state-failed">
            {job.error}
          </p>
        )}
      </div>

      <div className="scroll-panel mt-4 min-h-0 flex-1 pr-1">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
            Result
          </h3>
          {job.result ? (
            <JobResultCard result={job.result} />
          ) : (
            <EmptyState title="No results yet" description="Results appear once the job completes." />
          )}
        </section>

        <section className="mt-5">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
            Agent trace
          </h3>
          <JobTrace events={job.events} />
        </section>
      </div>
    </Card>
  );
}
