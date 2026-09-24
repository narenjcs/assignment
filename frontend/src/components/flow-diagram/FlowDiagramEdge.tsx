import type { ReactElement } from 'react';

import type { FlowEdge, FlowEdgeId } from '../../lib/flow-model';
import { edgePath } from './layout';

export interface FlowDiagramEdgeProps {
  id: FlowEdgeId;
  edge: FlowEdge;
  reducedMotion: boolean;
}

const STATE_CLASS: Record<FlowEdge['state'], string> = {
  pending: 'stroke-white/20',
  active: 'stroke-white/80',
  done: 'stroke-white/45',
  skipped: 'stroke-white/10',
};

// The one edge the whole dialog exists to prove (UI-PLAN §1): PDF Agent (Databricks) calling
// back into MCP Gateway (AWS). Always dashed with its own label, regardless of state.
const BACKWARD_FLOW_ID: FlowEdgeId = 'pdfToGatewayCallback';

/** One connector between two nodes. The backward-flow edge is always dashed and labelled; every
 * other edge is a plain line that only dashes when `skipped` and only animates while `active`
 * (and never when the viewer prefers reduced motion). */
export function FlowDiagramEdge({ id, edge, reducedMotion }: FlowDiagramEdgeProps): ReactElement {
  const isBackward = id === BACKWARD_FLOW_ID;
  const animate = edge.state === 'active' && !reducedMotion;
  const d = edgePath(id);

  return (
    <g>
      <path
        d={d}
        fill="none"
        markerEnd="url(#flow-arrow-dark)"
        strokeWidth={isBackward ? 1.75 : 1.25}
        strokeDasharray={isBackward || edge.state === 'skipped' ? '5 4' : undefined}
        className={`${STATE_CLASS[edge.state]} ${animate ? 'animate-flow-dash' : ''}`}
      />
      {isBackward && (
        <text x={430} y="308" textAnchor="middle" className="fill-white/60 text-[8px] font-semibold">
          BACKWARD FLOW
        </text>
      )}
    </g>
  );
}
