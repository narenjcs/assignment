import { useMemo, useState, type ReactElement } from 'react';

import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { FlowDiagramDialog } from '../../components/FlowDiagramDialog';
import { computeFlowModel } from '../../lib/flow-model';
import type { Job } from '../../types/job';
import type { SseEvent } from '../../types/sse';
import { JobDetailBody } from './JobDetailBody';
import { JobStatusHeader } from './JobStatusHeader';
import { ViewFlowButton } from './ViewFlowButton';

export interface JobDetailProps {
  job: Job | null;
  liveEvents?: SseEvent[];
}

/** Detail panel for the selected job: status stepper, result card, agent trace — plus a "View
 * flow" button that opens the architecture diagram as a full-width dialog (UI-PLAN §1). The
 * stepper/status block stays pinned while the result + trace section scrolls under it. */
export function JobDetail({ job, liveEvents = [] }: JobDetailProps): ReactElement {
  const [flowOpen, setFlowOpen] = useState(false);
  // Computed even with no job selected: the dialog opens fine with every node 'pending', which
  // doubles as an architecture overview (UI-PLAN §1).
  const model = useMemo(() => computeFlowModel(job, liveEvents), [job, liveEvents]);
  const openFlow = (): void => setFlowOpen(true);
  const closeFlow = (): void => setFlowOpen(false);

  if (!job) {
    return (
      <Card title="Job detail" className="flex h-full min-h-0 flex-col">
        <div className="mb-3 shrink-0">
          <ViewFlowButton onClick={openFlow} />
        </div>
        <EmptyState
          title="No job selected"
          description="Pick a job from the list, or upload a new document."
        />
        {flowOpen && <FlowDiagramDialog model={model} onClose={closeFlow} />}
      </Card>
    );
  }

  return (
    <Card title={job.fileName} className="flex h-full min-h-0 flex-col">
      <JobStatusHeader job={job} onViewFlow={openFlow} />
      <JobDetailBody job={job} />
      {flowOpen && <FlowDiagramDialog model={model} onClose={closeFlow} />}
    </Card>
  );
}
