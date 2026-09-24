import type { ReactElement } from 'react';

import type { FlowNode, FlowNodeId, NodeState, PdfSubStep } from '../../lib/flow-model';
import { BAND_CLASSES, NODE_BAND, NODE_H, NODE_LABEL, NODE_POS, NODE_W } from './layout';

export interface FlowDiagramNodeProps {
  id: FlowNodeId;
  node: FlowNode;
  subSteps: Record<PdfSubStep, NodeState> | null;
  isHighlighted: boolean;
  reducedMotion: boolean;
  onClick?: ((id: FlowNodeId) => void) | undefined;
}

const SUBSTEP_ORDER: readonly PdfSubStep[] = ['ingest', 'extract', 'enrich', 'persist'];

function shapeClasses(state: NodeState, band: 'aws' | 'databricks'): string {
  const colors = BAND_CLASSES[band];
  switch (state) {
    case 'active':
      return `${colors.stroke} ${colors.activeFill}`;
    case 'done':
      return `${colors.stroke} ${colors.doneFill}`;
    case 'failed':
      return 'stroke-state-failed fill-state-failed/15';
    case 'skipped':
      return 'stroke-slate-300 dark:stroke-slate-600 fill-transparent opacity-40';
    default:
      return 'stroke-slate-400 dark:stroke-slate-500 fill-surface-card';
  }
}

function tooltipFor(node: FlowNode, label: string): string {
  if (node.events.length === 0) return `${label}: ${node.state}`;
  const last = node.events.at(-1);
  return `${label}: ${node.state}${last ? ` — ${last.tool ?? last.message} (${last.source})` : ''}`;
}

function SubStepDots({ subSteps }: { subSteps: Record<PdfSubStep, NodeState> }): ReactElement {
  return (
    <g>
      {SUBSTEP_ORDER.map((step, index) => (
        <circle
          key={step}
          cx={-15 + index * 10}
          cy={NODE_H + 8}
          r={2.5}
          className={
            subSteps[step] === 'pending'
              ? 'fill-slate-300 dark:fill-slate-600'
              : subSteps[step] === 'failed'
                ? 'fill-state-failed'
                : 'fill-brand-databricks-accent'
          }
        >
          <title>{`${step}: ${subSteps[step]}`}</title>
        </circle>
      ))}
    </g>
  );
}

/** One node's shape + label + (for pdfAgent) its 4 sub-step dots. Purely presentational — state
 * comes from `computeFlowModel`, geometry from `layout.ts`. */
export function FlowDiagramNode({
  id,
  node,
  subSteps,
  isHighlighted,
  reducedMotion,
  onClick,
}: FlowDiagramNodeProps): ReactElement {
  const pos = NODE_POS[id];
  const label = NODE_LABEL[id];
  const pulse = node.state === 'active' && !reducedMotion ? 'animate-pulse' : '';
  const mark = node.state === 'done' ? '✓ ' : node.state === 'failed' ? '✕ ' : '';

  return (
    <g
      transform={`translate(${pos.x - NODE_W / 2}, ${pos.y - NODE_H / 2})`}
      onClick={() => onClick?.(id)}
      className={node.state === 'skipped' ? '' : 'cursor-pointer'}
    >
      <title>{tooltipFor(node, label)}</title>
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={8}
        strokeWidth={isHighlighted ? 2.5 : 1.5}
        strokeDasharray={node.state === 'skipped' ? '3 3' : undefined}
        className={`${shapeClasses(node.state, NODE_BAND[id])} ${pulse} ${isHighlighted ? 'stroke-accent' : ''}`}
      />
      <text
        x={NODE_W / 2}
        y={NODE_H / 2 + 4}
        textAnchor="middle"
        className="fill-ink/85 text-[10px] font-medium"
      >
        {mark}
        {label}
      </text>
      {subSteps && <SubStepDots subSteps={subSteps} />}
    </g>
  );
}
