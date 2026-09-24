import { useState, type ReactElement } from 'react';

import type { FlowModel, FlowNodeId } from '../lib/flow-model';
import { FlowDiagram } from './FlowDiagram';
import { FlowDiagramInspector } from './flow-diagram/FlowDiagramInspector';
import { useDialogA11y } from './flow-diagram/useDialogA11y';

export interface FlowDiagramDialogProps {
  model: FlowModel;
  onClose: () => void;
}

const TITLE_ID = 'flow-diagram-dialog-title';

/** Full-width "System architecture flow" overlay (UI-PLAN §1), opened from Job detail's
 * "View flow" button. Always a dark console panel regardless of the app's light/dark setting —
 * the one deliberate exception to the rest of the palette (see FlowDiagramNode/nodeStyle). Focus
 * trapped, Esc closes, focus returns to the opener, body scroll locked, horizontal scroll on
 * narrow screens rather than squashing the diagram. */
export function FlowDiagramDialog({ model, onClose }: FlowDiagramDialogProps): ReactElement {
  const containerRef = useDialogA11y(true, onClose);
  const [inspectedNodeId, setInspectedNodeId] = useState<FlowNodeId | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-5xl flex-col rounded-xl border border-white/10 bg-[#0a0a0b] p-4 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)] outline-none"
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h2 id={TITLE_ID} className="text-xs font-bold tracking-[0.1em] text-white">
            SYSTEM ARCHITECTURE FLOW
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close architecture flow"
            className="rounded-md px-2 py-1 text-xs text-white/60 hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-400"
          >
            Esc ✕
          </button>
        </div>

        <div className="scroll-panel overflow-x-auto rounded-lg border border-white/10">
          <FlowDiagram model={model} titleId={`${TITLE_ID}-svg`} onInspectNode={setInspectedNodeId} />
        </div>

        <div className="mt-3 shrink-0 border-t border-white/10 pt-2">
          <FlowDiagramInspector model={model} inspectedNodeId={inspectedNodeId} />
        </div>
      </div>
    </div>
  );
}
