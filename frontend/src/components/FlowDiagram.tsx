import type { ReactElement } from 'react';

import { FLOW_EDGE_IDS, FLOW_NODE_IDS, type FlowModel, type FlowNodeId } from '../lib/flow-model';
import { FlowDiagramColumns } from './flow-diagram/FlowDiagramColumns';
import { FlowDiagramEdge } from './flow-diagram/FlowDiagramEdge';
import { FlowDiagramNode } from './flow-diagram/FlowDiagramNode';
import { VIEWBOX } from './flow-diagram/layout';
import { useReducedMotion } from './flow-diagram/useReducedMotion';

export interface FlowDiagramProps {
  model: FlowModel;
  titleId: string;
  onInspectNode?: ((id: FlowNodeId | null) => void) | undefined;
}

/** Hand-written inline SVG of the DocIntel pipeline (UI-PLAN §1): dark console canvas, two cloud
 * columns, node/edge state driven purely by `computeFlowModel`'s output. Presentational only. */
export function FlowDiagram({ model, titleId, onInspectNode }: FlowDiagramProps): ReactElement {
  const reducedMotion = useReducedMotion();

  return (
    <svg
      viewBox={VIEWBOX}
      role="img"
      aria-labelledby={titleId}
      className="h-auto w-full min-w-[720px]"
    >
      <title id={titleId}>{model.summary}</title>
      <FlowDiagramColumns />

      {FLOW_EDGE_IDS.map((id) => (
        <FlowDiagramEdge key={id} id={id} edge={model.edges[id]} reducedMotion={reducedMotion} />
      ))}
      {FLOW_NODE_IDS.map((id) => (
        <FlowDiagramNode key={id} id={id} node={model.nodes[id]} onInspectNode={onInspectNode} />
      ))}
    </svg>
  );
}
