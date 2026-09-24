// Pure geometry for the "System architecture flow" dialog (UI-PLAN §1). No React — the SVG
// components only look these numbers up. Two cloud columns (AWS / Databricks) split at
// `DIVIDER_X`; positions roughly mirror Naren's mockup so the backward-flow edge (PDF Agent ->
// MCP Gateway) reads as a clear diagonal crossing back over the divider.

import { FLOW_EDGE_ENDPOINTS, type FlowEdgeId, type FlowNodeId } from '../../lib/flow-model';

export const VIEWBOX = '0 0 760 320';
export const NODE_W = 108;
export const NODE_H = 58;
export const DIVIDER_X = 550;

export const NODE_LABEL: Record<FlowNodeId, string> = {
  browser: 'BROWSER',
  s3: 'S3',
  trigger: 'TRIGGER',
  orchestrator: 'ORCHESTRATOR',
  docxAgent: 'DOCX AGENT',
  mcpGateway: 'MCP GATEWAY',
  pdfAgent: 'PDF AGENT',
  ucVolume: 'VOLUME',
  ucTable: 'TABLE',
};

export type IconKey = 'browser' | 'bolt' | 'hub' | 'document' | 'cylinder' | 'grid' | 'gateway';

export const NODE_ICON: Record<FlowNodeId, IconKey> = {
  browser: 'browser',
  s3: 'cylinder',
  trigger: 'bolt',
  orchestrator: 'hub',
  docxAgent: 'document',
  mcpGateway: 'gateway',
  pdfAgent: 'document',
  ucVolume: 'cylinder',
  ucTable: 'grid',
};

export type CloudBand = 'aws' | 'databricks';

export const NODE_BAND: Record<FlowNodeId, CloudBand> = {
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

export interface Point {
  x: number;
  y: number;
}

// Every Databricks node (ucVolume, pdfAgent, ucTable) must sit to the RIGHT of DIVIDER_X and
// every AWS node to the left: the divider is what tells the viewer which cloud owns a step, so a
// node on the wrong side is a factual error, not a cosmetic one. `layout.test.ts` enforces it.
export const NODE_POS: Record<FlowNodeId, Point> = {
  browser: { x: 80, y: 50 },
  s3: { x: 210, y: 50 },
  trigger: { x: 340, y: 50 },
  orchestrator: { x: 470, y: 50 },
  ucVolume: { x: 650, y: 50 },
  docxAgent: { x: 340, y: 170 },
  pdfAgent: { x: 650, y: 170 },
  ucTable: { x: 660, y: 260 },
  mcpGateway: { x: 210, y: 260 },
};

/** Straight edge trimmed to just outside each node's rounded card, so the arrowhead lands on
 * the border rather than under it. */
function straightPath(id: FlowEdgeId): string {
  const { from, to } = FLOW_EDGE_ENDPOINTS[id];
  const a = NODE_POS[from];
  const b = NODE_POS[to];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const padA = NODE_W / 2 + 4;
  const padB = NODE_H / 2 + 12;
  const startX = a.x + (dx / len) * padA;
  const startY = a.y + (dy / len) * padB;
  const endX = b.x - (dx / len) * padA;
  const endY = b.y - (dy / len) * padB;
  return `M ${startX} ${startY} L ${endX} ${endY}`;
}

const CURVED_EDGES: Partial<Record<FlowEdgeId, string>> = {
  // The one edge the whole view exists to prove: PDF Agent (Databricks) calling back into MCP
  // Gateway (AWS) — a wide arc back across the divider so it reads as unmistakably "backward".
  pdfToGatewayCallback: 'M 610 190 C 480 320, 320 320, 240 288',
  orchestratorToGateway: 'M 440 68 C 340 140, 280 190, 232 232',
};

/** Looks up (or computes) an edge's SVG path `d` attribute. */
export function edgePath(id: FlowEdgeId): string {
  return CURVED_EDGES[id] ?? straightPath(id);
}
