// Static SVG geometry for FlowDiagram — presentational only, no state derivation here (that
// lives in lib/flow-model.ts / lib/flow-signals.ts). Coordinates are hand-tuned to match the
// two-band sketch in docs/UI-PLAN.md §1.

import { FLOW_EDGE_ENDPOINTS, FLOW_EDGE_IDS, type FlowEdgeId, type FlowNodeId } from '../../lib/flow-model';

export const VIEWBOX = '0 0 880 270';
export const NODE_W = 84;
export const NODE_H = 40;

export const NODE_LABEL: Record<FlowNodeId, string> = {
  browser: 'Browser',
  s3: 'S3',
  trigger: 'S3 Trigger',
  orchestrator: 'Orchestrator',
  docxAgent: 'DOCX Agent',
  mcpGateway: 'MCP Gateway',
  pdfAgent: 'PDF Agent',
  ucVolume: 'UC Volume',
  ucTable: 'UC Table',
};

export const NODE_POS: Record<FlowNodeId, { x: number; y: number }> = {
  browser: { x: 60, y: 56 },
  s3: { x: 168, y: 56 },
  trigger: { x: 276, y: 56 },
  orchestrator: { x: 390, y: 56 },
  docxAgent: { x: 498, y: 56 },
  mcpGateway: { x: 300, y: 200 },
  pdfAgent: { x: 660, y: 56 },
  ucVolume: { x: 610, y: 200 },
  ucTable: { x: 760, y: 200 },
};

/** Which cloud band a node belongs to — for provenance-only colour tinting, never state. */
export const NODE_BAND: Record<FlowNodeId, 'aws' | 'databricks'> = {
  browser: 'aws',
  s3: 'aws',
  trigger: 'aws',
  orchestrator: 'aws',
  docxAgent: 'aws',
  mcpGateway: 'aws',
  pdfAgent: 'databricks',
  ucVolume: 'databricks',
  ucTable: 'databricks',
};

export const AWS_BAND_RECT = { x: 16, y: 12, w: 534, h: 232 };
export const DATABRICKS_BAND_RECT = { x: 566, y: 12, w: 298, h: 232 };

/** Tailwind classes for each band's fill/stroke/text — literal strings so the JIT scanner
 * picks them up (constructing them from a template string would silently drop them). */
export const BAND_CLASSES = {
  aws: {
    stroke: 'stroke-brand-aws-accent',
    text: 'fill-brand-aws',
    activeFill: 'fill-brand-aws-accent/25',
    doneFill: 'fill-brand-aws-accent/15',
  },
  databricks: {
    stroke: 'stroke-brand-databricks-accent',
    text: 'fill-brand-databricks',
    activeFill: 'fill-brand-databricks-accent/25',
    doneFill: 'fill-brand-databricks-accent/15',
  },
} as const;

function straightPath(id: FlowEdgeId): string {
  const { from, to } = FLOW_EDGE_ENDPOINTS[id];
  const a = NODE_POS[from];
  const b = NODE_POS[to];
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

// The databricks->gateway callback is the single most important line in the diagram (UI-PLAN
// §1): it arcs under both cloud bands so it reads as its own distinct path instead of crossing
// through unrelated nodes.
const CALLBACK_PATH = 'M 660 76 C 660 262, 300 262, 300 220';

export const EDGE_PATHS: Record<FlowEdgeId, string> = Object.fromEntries(
  FLOW_EDGE_IDS.map((id) => [id, id === 'pdfToGatewayCallback' ? CALLBACK_PATH : straightPath(id)]),
) as Record<FlowEdgeId, string>;
