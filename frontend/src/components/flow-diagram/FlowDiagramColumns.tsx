import type { ReactElement } from 'react';

import { DIVIDER_X, VIEWBOX } from './layout';

const [, , W, H] = VIEWBOX.split(' ').map(Number) as [number, number, number, number];

/** Dark console background: faint 1px grid, the AWS / Databricks column headers with a
 * cloud-coloured underline each, and the vertical divider between them. Always dark — this
 * dialog deliberately ignores the app's light/dark setting (UI-PLAN §1). */
export function FlowDiagramColumns(): ReactElement {
  return (
    <>
      <defs>
        <pattern id="flow-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        </pattern>
        <marker id="flow-arrow-dark" markerWidth="7" markerHeight="7" refX="5.5" refY="2.5" orient="auto">
          <path d="M0,0 L5.5,2.5 L0,5 Z" fill="rgba(255,255,255,0.6)" />
        </marker>
      </defs>

      <rect x={0} y={0} width={W} height={H} fill="#0a0a0b" />
      <rect x={0} y={0} width={W} height={H} fill="url(#flow-grid)" />

      <text x={16} y={16} className="fill-orange-400 text-[10px] font-bold" style={{ letterSpacing: '0.08em' }}>
        AWS
      </text>
      <line x1={16} y1={22} x2={DIVIDER_X - 24} y2={22} stroke="#fb923c" strokeWidth={2} opacity={0.7} />

      <text
        x={DIVIDER_X + 16}
        y={16}
        className="fill-red-400 text-[10px] font-bold"
        style={{ letterSpacing: '0.08em' }}
      >
        DATABRICKS
      </text>
      <line x1={DIVIDER_X + 16} y1={22} x2={W - 16} y2={22} stroke="#f87171" strokeWidth={2} opacity={0.7} />

      <line x1={DIVIDER_X} y1={0} x2={DIVIDER_X} y2={H} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
    </>
  );
}
