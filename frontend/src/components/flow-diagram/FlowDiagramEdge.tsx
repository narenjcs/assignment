import type { ReactElement } from 'react';

import type { FlowEdge, FlowEdgeId } from '../../lib/flow-model';
import { EDGE_PATHS } from './layout';

export interface FlowDiagramEdgeProps {
  id: FlowEdgeId;
  edge: FlowEdge;
  reducedMotion: boolean;
}

function edgeClasses(edge: FlowEdge, isCallback: boolean): string {
  if (edge.state === 'skipped') return 'stroke-slate-200 dark:stroke-slate-800';
  if (edge.state === 'pending') return 'stroke-slate-300 dark:stroke-slate-700';
  const provenance = isCallback
    ? 'stroke-brand-databricks-accent'
    : 'stroke-slate-400 dark:stroke-slate-500';
  return edge.state === 'active' ? `${provenance} stroke-[2.5]` : provenance;
}

/** One edge's path. The databricks->gateway callback (UI-PLAN §1's "single most important
 * line") renders dashed and thicker so it reads as its own distinct arc under both bands. */
export function FlowDiagramEdge({ id, edge, reducedMotion }: FlowDiagramEdgeProps): ReactElement {
  const isCallback = id === 'pdfToGatewayCallback';
  const animate = edge.state === 'active' && !reducedMotion;
  const showArrow = edge.state !== 'pending' && edge.state !== 'skipped';

  return (
    <path
      d={EDGE_PATHS[id]}
      fill="none"
      strokeWidth={isCallback ? 2 : 1.5}
      strokeDasharray={isCallback ? '5 4' : undefined}
      className={`${edgeClasses(edge, isCallback)} ${animate ? 'animate-flow-dash' : ''}`}
      markerEnd={showArrow ? 'url(#flow-arrow)' : undefined}
    />
  );
}
