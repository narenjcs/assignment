import { useMemo, type ReactElement } from 'react';

import { FLOW_EDGE_IDS, FLOW_NODE_IDS, type FlowModel, type FlowNodeId } from '../lib/flow-model';
import { FlowDiagramEdge } from './flow-diagram/FlowDiagramEdge';
import { FlowDiagramNode } from './flow-diagram/FlowDiagramNode';
import { AWS_BAND_RECT, DATABRICKS_BAND_RECT, NODE_LABEL, VIEWBOX } from './flow-diagram/layout';
import { useReducedMotion } from './flow-diagram/useReducedMotion';

export interface FlowDiagramProps {
  model: FlowModel;
  highlightedNodeId?: FlowNodeId | null;
  onNodeClick?: (nodeId: FlowNodeId) => void;
}

const TITLE_ID = 'flow-diagram-title';

/** Hand-written inline SVG of the DocIntel pipeline (UI-PLAN §1): two cloud bands, node/edge
 * state driven purely by `computeFlowModel`'s output. Presentational only — no event logic. */
export function FlowDiagram({
  model,
  highlightedNodeId = null,
  onNodeClick,
}: FlowDiagramProps): ReactElement {
  const reducedMotion = useReducedMotion();
  const jumpTargets = useMemo(
    () => FLOW_NODE_IDS.filter((id) => model.nodes[id].state !== 'skipped'),
    [model.nodes],
  );

  return (
    <div className="mt-3">
      <svg
        viewBox={VIEWBOX}
        role="img"
        aria-labelledby={TITLE_ID}
        tabIndex={0}
        className="w-full text-slate-500 dark:text-slate-400"
      >
        <title id={TITLE_ID}>{model.summary}</title>
        <defs>
          <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" className="fill-slate-400 dark:fill-slate-500" />
          </marker>
        </defs>

        <rect
          x={AWS_BAND_RECT.x}
          y={AWS_BAND_RECT.y}
          width={AWS_BAND_RECT.w}
          height={AWS_BAND_RECT.h}
          rx={12}
          strokeDasharray="4 3"
          className="fill-brand-aws-accent/5 stroke-brand-aws-accent/30"
        />
        <text
          x={AWS_BAND_RECT.x + 10}
          y={AWS_BAND_RECT.y + 16}
          className="fill-brand-aws text-[10px] font-semibold uppercase"
          style={{ letterSpacing: '0.05em' }}
        >
          AWS
        </text>

        <rect
          x={DATABRICKS_BAND_RECT.x}
          y={DATABRICKS_BAND_RECT.y}
          width={DATABRICKS_BAND_RECT.w}
          height={DATABRICKS_BAND_RECT.h}
          rx={12}
          strokeDasharray="4 3"
          className="fill-brand-databricks-accent/5 stroke-brand-databricks-accent/30"
        />
        <text
          x={DATABRICKS_BAND_RECT.x + 10}
          y={DATABRICKS_BAND_RECT.y + 16}
          className="fill-brand-databricks text-[10px] font-semibold uppercase"
          style={{ letterSpacing: '0.05em' }}
        >
          Databricks
        </text>

        {FLOW_EDGE_IDS.map((id) => (
          <FlowDiagramEdge key={id} id={id} edge={model.edges[id]} reducedMotion={reducedMotion} />
        ))}
        {FLOW_NODE_IDS.map((id) => (
          <FlowDiagramNode
            key={id}
            id={id}
            node={model.nodes[id]}
            subSteps={id === 'pdfAgent' ? model.subSteps : null}
            isHighlighted={highlightedNodeId === id}
            reducedMotion={reducedMotion}
            onClick={onNodeClick}
          />
        ))}
      </svg>

      <p className="sr-only">{model.summary}</p>

      {/* Keyboard-operable equivalent of clicking a node. The SVG above is one `role="img"`
          unit for screen readers (UI-PLAN §1), so this row — hidden until focused — is how a
          keyboard user reaches the diagram's node-click behaviour (UI-PLAN §3 a11y). */}
      <div className="flex flex-wrap gap-1">
        {jumpTargets.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onNodeClick?.(id)}
            className="sr-only focus:not-sr-only focus:static focus:rounded focus:border focus:border-accent focus:bg-surface-card focus:px-2 focus:py-1 focus:text-xs"
          >
            Jump to {NODE_LABEL[id]} events
          </button>
        ))}
      </div>
    </div>
  );
}
