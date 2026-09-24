import type { ReactElement } from 'react';

import { Badge } from '../../components/Badge';
import { Stepper } from '../../components/Stepper';
import type { Job } from '../../types/job';
import { ViewFlowButton } from './ViewFlowButton';

export interface JobStatusHeaderProps {
  job: Job;
  onViewFlow: () => void;
}

/** Pinned block above the scrolling result/trace section: status badge, mode, stepper, any
 * error, and the "View flow" button that opens the architecture dialog. */
export function JobStatusHeader({ job, onViewFlow }: JobStatusHeaderProps): ReactElement {
  return (
    <div className="shrink-0">
      <div
        aria-live="polite"
        className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400"
      >
        <Badge variant="status" status={job.status}>
          {job.status}
        </Badge>
        <span className="capitalize">{job.mode} mode</span>
        {job.processor && <span>· {job.processor}</span>}
        <span className="ml-auto">
          <ViewFlowButton onClick={onViewFlow} />
        </span>
      </div>

      <Stepper status={job.status} />

      {job.error !== undefined && (
        <p role="alert" className="mt-3 text-xs text-state-failed">
          {job.error}
        </p>
      )}
    </div>
  );
}
