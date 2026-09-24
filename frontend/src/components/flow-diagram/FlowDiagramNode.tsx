import type { ReactElement } from 'react';

import type { FlowNode, FlowNodeId } from '../../lib/flow-model';
import { NODE_BAND, NODE_H, NODE_ICON, NODE_LABEL, NODE_POS, NODE_W } from './layout';
import { NodeIcon } from './NodeIcon';
import { activeBorderColor, nodeVisual } from './nodeStyle';
import { NodeStatusPill } from './NodeStatusPill';

export interface FlowDiagramNodeProps {
  id: FlowNodeId;
  node: FlowNode;
  /** Fired on hover or keyboard focus with this node's id, and with `null` when it clears —
   * drives the "real events that hit this node" readout below the canvas. */
  onInspectNode?: ((id: FlowNodeId | null) => void) | undefined;
}

function tooltipFor(node: FlowNode, label: string): string {
  if (node.events.length === 0) return `${label}: ${node.state}`;
  const last = node.events.at(-1);
  return `${label}: ${node.state}${last ? ` — ${last.tool ?? last.message}` : ''}`;
}

/** One rounded-square node card: icon, uppercase label, status pill. Active nodes get a
 * coloured border + outer glow in their cloud's colour (the one deliberate palette exception —
 * see UI-PLAN §1); skipped nodes are dashed and dimmed so an off-path cloud band reads at a
 * glance. Focusable so keyboard users can inspect the events behind each node via the title. */
export function FlowDiagramNode({ id, node, onInspectNode }: FlowDiagramNodeProps): ReactElement {
  const pos = NODE_POS[id];
  const band = NODE_BAND[id];
  const label = NODE_LABEL[id];
  const visual = nodeVisual(node.state, band);
  const skipped = node.state === 'skipped';

  return (
    <g
      transform={`translate(${pos.x - NODE_W / 2}, ${pos.y - NODE_H / 2})`}
      tabIndex={0}
      onFocus={() => onInspectNode?.(id)}
      onBlur={() => onInspectNode?.(null)}
      onMouseEnter={() => onInspectNode?.(id)}
      onMouseLeave={() => onInspectNode?.(null)}
      style={{ outline: 'none' }}
    >
      <title>{tooltipFor(node, label)}</title>
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={10}
        fill="#131316"
        strokeWidth={node.state === 'active' ? 1.75 : 1.25}
        strokeDasharray={skipped ? '3 3' : undefined}
        opacity={skipped ? 0.45 : 1}
        stroke={node.state === 'active' ? activeBorderColor(band) : undefined}
        className={visual.cardClass}
        style={{ filter: visual.borderStyle.replace('filter: ', '') || undefined }}
      />
      <g transform={`translate(${NODE_W / 2 - 9}, 6)`} className="text-white/70">
        <NodeIcon icon={NODE_ICON[id]} />
      </g>
      <text
        x={NODE_W / 2}
        y={35}
        textAnchor="middle"
        className="fill-white text-[9px] font-semibold"
        style={{ letterSpacing: '0.03em' }}
      >
        {label}
      </text>
      <foreignObject x={NODE_W / 2 - 34} y={41} width={68} height={14}>
        <NodeStatusPill label={visual.pillLabel} className={visual.pillClass} />
      </foreignObject>
    </g>
  );
}
