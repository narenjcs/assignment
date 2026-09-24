import { useMemo, useState, type ReactElement } from 'react';

import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { FlowDiagram } from '../../components/FlowDiagram';
import { computeFlowModel, type FlowNodeId } from '../../lib/flow-model';
import type { Job } from '../../types/job';
import type { SseEvent } from '../../types/sse';
import { JobDetailBody } from './JobDetailBody';
import { JobStatusHeader } from './JobStatusHeader';

export interface JobDetailProps {
  job: Job | null;
  liveEvents?: SseEvent[];
}

function eventIndicesForNode(
  eventNodeMap: Partial<Record<number, FlowNodeId>>,
  nodeId: FlowNodeId,
): number[] {
  return Object.entries(eventNodeMap)
    .filter(([, id]) => id === nodeId)
    .map(([index]) => Number(index));
}

/** Detail panel for the selected job: diagram, status, progress, agent trace, results. The
 * diagram + status block stay pinned while the trace/results section scrolls under them. */
export function JobDetail({ job, liveEvents = [] }: JobDetailProps): ReactElement {
  const model = useMemo(() => computeFlowModel(job, liveEvents), [job, liveEvents]);
  const [focusedIndices, setFocusedIndices] = useState<number[]>([]);
  const [highlightedNodeId, setHighlightedNodeId] = useState<FlowNodeId | null>(null);
  const [traceOpen, setTraceOpen] = useState(job?.status !== 'COMPLETED');
  // Collapse the trace the moment a job finishes, without an effect: this "adjusts state
  // during render" (react.dev, "You Might Not Need an Effect") by comparing against the
  // previously-seen status and calling setState synchronously in the render body, which React
  // restarts immediately — avoiding the extra commit + re-render an effect-based setState causes.
  const [lastSeenStatus, setLastSeenStatus] = useState(job?.status);
  if (job?.status !== lastSeenStatus) {
    setLastSeenStatus(job?.status);
    if (job?.status === 'COMPLETED') setTraceOpen(false);
  }

  const handleNodeClick = (nodeId: FlowNodeId): void => {
    setFocusedIndices(eventIndicesForNode(model.eventNodeMap, nodeId));
    setTraceOpen(true);
  };
  const handleTraceHover = (index: number | null): void => {
    setHighlightedNodeId(index === null ? null : (model.eventNodeMap[index] ?? null));
  };

  if (!job) {
    return (
      <Card title="Job detail" className="flex h-full min-h-0 flex-col">
        <FlowDiagram model={model} onNodeClick={handleNodeClick} />
        <div className="mt-4 min-h-0 flex-1">
          <EmptyState
            title="No job selected"
            description="Pick a job from the list, or upload a new document."
          />
        </div>
      </Card>
    );
  }

  return (
    <Card title={job.fileName} className="flex h-full min-h-0 flex-col">
      <JobStatusHeader
        job={job}
        model={model}
        highlightedNodeId={highlightedNodeId}
        onNodeClick={handleNodeClick}
      />
      <JobDetailBody
        job={job}
        traceOpen={traceOpen}
        onToggleTrace={() => setTraceOpen((open) => !open)}
        focusedIndices={focusedIndices}
        onHoverEvent={handleTraceHover}
      />
    </Card>
  );
}
