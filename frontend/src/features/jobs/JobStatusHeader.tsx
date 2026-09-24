import type { ReactElement } from 'react';

import { Badge } from '../../components/Badge';
import { FlowDiagram } from '../../components/FlowDiagram';
import { Stepper } from '../../components/Stepper';
import type { FlowModel, FlowNodeId } from '../../lib/flow-model';
import type { Job } from '../../types/job';

export interface JobStatusHeaderProps {
  job: Job;
  model: FlowModel;
  highlightedNodeId: FlowNodeId | null;
  onNodeClick: (nodeId: FlowNodeId) => void;
}

/** Pinned block above the scrolling trace: status badge, stepper, error, flow diagram. Stays
 * visible while the trace/results section below it scrolls (UI-PLAN scrolling requirement). */
export function JobStatusHeader({
  job,
  model,
  highlightedNodeId,
  onNodeClick,
}: JobStatusHeaderProps): ReactElement {
  return (
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

      <FlowDiagram model={model} highlightedNodeId={highlightedNodeId} onNodeClick={onNodeClick} />
    </div>
  );
}
