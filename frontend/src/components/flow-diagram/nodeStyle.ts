// Pure style lookups for FlowDiagramNode — kept out of the component so its render function
// stays short. This dialog is always dark and uses cloud colour as *glow*, the one place
// UI-PLAN §3.1's "state, not provenance, gets the hue" rule is deliberately bent (§1 note).

import type { NodeState } from '../../lib/flow-model';
import type { CloudBand } from './layout';

const GLOW_COLOR: Record<CloudBand, string> = {
  aws: 'rgba(251,146,60,0.55)', // amber glow, AWS side
  databricks: 'rgba(248,113,113,0.55)', // red glow, Databricks side
};
const BORDER_COLOR: Record<CloudBand, string> = {
  aws: '#fb923c',
  databricks: '#f87171',
};

export interface NodeVisual {
  cardClass: string;
  borderStyle: string;
  pillLabel: string;
  pillClass: string;
}

const PILL_CLASS: Record<NodeState, string> = {
  pending: 'bg-white/10 text-white/50',
  active: 'bg-indigo-500/20 text-indigo-300',
  done: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-rose-500/20 text-rose-300',
  skipped: 'bg-white/5 text-white/35',
};

const PILL_LABEL: Record<NodeState, string> = {
  pending: 'Pending',
  active: 'Active',
  done: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** Card border + outer glow: active nodes glow in their cloud's colour; every other state is a
 * calm neutral card (skipped additionally dashed + ~45% opacity, applied by the caller). */
export function nodeVisual(state: NodeState, band: CloudBand): NodeVisual {
  const borderStyle =
    state === 'active'
      ? `filter: drop-shadow(0 0 6px ${GLOW_COLOR[band]}) drop-shadow(0 0 14px ${GLOW_COLOR[band]})`
      : '';
  const cardClass =
    state === 'active'
      ? ''
      : state === 'failed'
        ? 'stroke-rose-400'
        : state === 'done'
          ? 'stroke-white/25'
          : state === 'skipped'
            ? 'stroke-white/20'
            : 'stroke-white/15';
  return {
    cardClass,
    borderStyle,
    pillLabel: PILL_LABEL[state],
    pillClass: PILL_CLASS[state],
  };
}

export function activeBorderColor(band: CloudBand): string {
  return BORDER_COLOR[band];
}
