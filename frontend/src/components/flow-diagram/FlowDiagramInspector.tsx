import type { ReactElement } from 'react';

import { formatRelativeTime } from '../../lib/format';
import type { FlowModel, FlowNodeId } from '../../lib/flow-model';
import { NODE_LABEL } from './layout';

export interface FlowDiagramInspectorProps {
  model: FlowModel;
  inspectedNodeId: FlowNodeId | null;
}

/** Small readout below the canvas: hovering or focusing a node shows the real events that hit
 * it (tool + relative time), per UI-PLAN §1's "hover/focus shows the real events" behaviour. */
export function FlowDiagramInspector({
  model,
  inspectedNodeId,
}: FlowDiagramInspectorProps): ReactElement {
  if (!inspectedNodeId) {
    return <p className="text-[11px] text-white/40">Hover or focus a node to see its events.</p>;
  }

  const node = model.nodes[inspectedNodeId];
  if (node.events.length === 0) {
    return (
      <p className="text-[11px] text-white/40">
        {NODE_LABEL[inspectedNodeId]}: no events yet ({node.state}).
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {node.events.map((event, index) => (
        <li key={`${event.ts}-${index}`} className="text-[11px] text-white/70">
          <span className="font-mono text-white/50">{event.tool ?? event.message}</span>
          <span className="ml-2 tabular-nums text-white/35">{formatRelativeTime(event.ts)}</span>
        </li>
      ))}
    </ul>
  );
}
