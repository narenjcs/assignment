import type { ReactElement } from 'react';

import { EmptyState } from '../../components/EmptyState';
import type { Job } from '../../types/job';
import { JobResultCard } from './JobResultCard';
import { JobTrace } from './JobTrace';

export interface JobDetailBodyProps {
  job: Job;
}

/** Scrolling section below the pinned status header: result card, then agent trace. */
export function JobDetailBody({ job }: JobDetailBodyProps): ReactElement {
  return (
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

      {/* Collapsed once the job is COMPLETED (UI-PLAN §2): while a job runs the trace is the
          only thing telling the user anything is happening, so it stays open; afterwards the
          result is the answer and the trace becomes supporting detail the user can expand. */}
      <details className="mt-5" open={job.status !== 'COMPLETED'}>
        <summary className="mb-2 cursor-pointer list-none text-xs font-semibold tracking-wide text-slate-400 uppercase marker:content-[''] hover:text-slate-500">
          Agent trace
          <span className="ml-2 font-normal normal-case tabular-nums text-slate-400">
            ({job.events.length})
          </span>
        </summary>
        <JobTrace events={job.events} />
      </details>
    </div>
  );
}
