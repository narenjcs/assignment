import type { ReactElement } from 'react';

import { EmptyState } from '../../components/EmptyState';
import type { Job } from '../../types/job';
import { JobResultCard } from './JobResultCard';
import { JobTrace } from './JobTrace';

export interface JobDetailBodyProps {
  job: Job;
  traceOpen: boolean;
  onToggleTrace: () => void;
  focusedIndices: number[];
  onHoverEvent: (index: number | null) => void;
}

/** Scrolling section below the pinned status header: collapsible agent trace + results. */
export function JobDetailBody({
  job,
  traceOpen,
  onToggleTrace,
  focusedIndices,
  onHoverEvent,
}: JobDetailBodyProps): ReactElement {
  return (
    <div className="scroll-panel mt-4 min-h-0 flex-1 pr-1">
      <section>
        <button
          type="button"
          onClick={onToggleTrace}
          aria-expanded={traceOpen}
          className="mb-2 flex w-full items-center justify-between text-xs font-semibold tracking-wide text-slate-400 uppercase"
        >
          Agent trace
          <span aria-hidden="true">{traceOpen ? '−' : '+'}</span>
        </button>
        {traceOpen && (
          <JobTrace
            events={job.events}
            highlightedIndices={focusedIndices}
            onHoverEvent={onHoverEvent}
          />
        )}
      </section>

      <section className="mt-4">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Results
        </h3>
        {job.result ? (
          <JobResultCard result={job.result} />
        ) : (
          <EmptyState title="No results yet" description="Results appear once the job completes." />
        )}
      </section>
    </div>
  );
}
