// Pure events -> node-state mapping for the live agent-flow diagram (UI-PLAN §1). No React here;
// `FlowDiagram.tsx` only renders what `computeFlowModel` returns (topology/signals live in
// `flow-signals.ts`). COMPLETED clamps the path to 'done'; FAILED marks the furthest node
// 'failed'; a DOCX job skips the Databricks band, and a PDF job skips the DOCX agent.

import type { DocType, Job } from '../types/job';
import type { SseEvent } from '../types/sse';
import {
  buildSignals,
  edgeTouches,
  FLOW_EDGE_ENDPOINTS,
  FLOW_EDGE_IDS,
  FLOW_NODE_IDS,
  gatewayEdgeFor,
  isEdgeSkipped,
  isGatewaySignal,
  isNodeSkipped,
  nodesForSignal,
  pathFor,
  pdfSubStepOf,
  PDF_SUBSTEPS,
  type FlowEdgeId,
  type FlowNodeId,
  type FlowSignal,
  type PdfSubStep,
  type SkipCtx,
} from './flow-signals';

export { FLOW_NODE_IDS, FLOW_EDGE_IDS, FLOW_EDGE_ENDPOINTS, PDF_SUBSTEPS };
export type { FlowNodeId, FlowEdgeId, PdfSubStep };

export type NodeState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';
export type EdgeState = 'pending' | 'active' | 'done' | 'skipped';
type Terminal = 'completed' | 'failed' | null;

export interface FlowEventRef {
  eventIndex?: number;
  ts: string;
  source: FlowSignal['source'];
  tool?: string;
  message: string;
  live: boolean;
}

export interface FlowNode {
  id: FlowNodeId;
  state: NodeState;
  events: FlowEventRef[];
}
export interface FlowEdge {
  id: FlowEdgeId;
  state: EdgeState;
}

export interface FlowModel {
  docType: DocType | null;
  nodes: Record<FlowNodeId, FlowNode>;
  edges: Record<FlowEdgeId, FlowEdge>;
  subSteps: Record<PdfSubStep, NodeState>;
  activeNodeId: FlowNodeId | null;
  summary: string;
  /** job.events[] index -> primary node id, for trace<->diagram wiring. */
  eventNodeMap: Partial<Record<number, FlowNodeId>>;
}

const PERSIST_INDEX = PDF_SUBSTEPS.length - 1;

function terminalOf(job: Job | null): Terminal {
  if (job?.status === 'COMPLETED') return 'completed';
  if (job?.status === 'FAILED') return 'failed';
  return null;
}

/** Nodes before the furthest-touched index are 'done'; the furthest is 'active'/'failed'/'done'. */
function rankState(index: number, maxIndex: number, terminal: Terminal): NodeState {
  if (index > maxIndex) return 'pending';
  if (index < maxIndex) return 'done';
  if (terminal === 'failed') return 'failed';
  if (terminal === 'completed') return 'done';
  return 'active';
}

function maxTouchedIndex(path: readonly FlowNodeId[], signals: readonly FlowSignal[]): number {
  let max = -1;
  for (const signal of signals) {
    for (const node of nodesForSignal(signal)) {
      const index = path.indexOf(node);
      if (index > max) max = index;
    }
  }
  return max;
}

function buildPathStates(
  path: readonly FlowNodeId[],
  signals: readonly FlowSignal[],
  terminal: Terminal,
): Partial<Record<FlowNodeId, NodeState>> {
  const rawMax = maxTouchedIndex(path, signals);
  const maxIndex = terminal === 'completed' ? path.length - 1 : rawMax;
  const states: Partial<Record<FlowNodeId, NodeState>> = {};
  path.forEach((id, index) => {
    states[id] = rankState(index, maxIndex, terminal);
  });
  return states;
}

function maxSubstepIndex(signals: readonly FlowSignal[]): number {
  let max = -1;
  for (const signal of signals) {
    const step = pdfSubStepOf(signal);
    if (step) max = Math.max(max, PDF_SUBSTEPS.indexOf(step));
  }
  return max;
}

function buildSubStepStates(
  signals: readonly FlowSignal[],
  terminal: Terminal,
): Record<PdfSubStep, NodeState> {
  const maxIndex = terminal === 'completed' ? PERSIST_INDEX : maxSubstepIndex(signals);
  const states = {} as Record<PdfSubStep, NodeState>;
  PDF_SUBSTEPS.forEach((step, index) => {
    states[step] = rankState(index, maxIndex, terminal);
  });
  return states;
}

function hasDatabricksCallback(signals: readonly FlowSignal[]): boolean {
  return signals.some((s) => isGatewaySignal(s) && s.source === 'databricks');
}
function hasDocxSave(signals: readonly FlowSignal[]): boolean {
  return signals.some((s) => s.agent === 'docx-agent' && s.tool === 'save_job_result');
}

/** `terminal !== null` freezes to 'done' instead of 'active': a finished job pulses nothing. */
function ucVolumeState(maxSubIdx: number, terminal: Terminal): NodeState {
  if (terminal === 'completed' || maxSubIdx > 0) return 'done';
  if (maxSubIdx === 0) return terminal === null ? 'active' : 'done';
  return 'pending';
}
function ucTableState(maxSubIdx: number, callbackSeen: boolean, terminal: Terminal): NodeState {
  if (terminal === 'completed' || callbackSeen) return 'done';
  if (maxSubIdx >= PERSIST_INDEX) return terminal === null ? 'active' : 'done';
  return 'pending';
}

/** Gateway node is 'active' while the latest gateway-tool call is still the last signal. */
function gatewayNodeState(signals: readonly FlowSignal[], terminal: Terminal): NodeState {
  const lastGatewayIndex = signals.map(isGatewaySignal).lastIndexOf(true);
  if (lastGatewayIndex === -1) return 'pending';
  const isLastSignal = lastGatewayIndex === signals.length - 1;
  if (terminal === 'failed' && isLastSignal) return 'failed';
  if (isLastSignal && terminal === null) return 'active';
  return 'done';
}

function buildEdges(
  signals: readonly FlowSignal[],
  terminal: Terminal,
  ctx: SkipCtx,
): Record<FlowEdgeId, FlowEdge> {
  const edges = {} as Record<FlowEdgeId, FlowEdge>;
  for (const id of FLOW_EDGE_IDS) {
    if (isEdgeSkipped(id, ctx)) {
      edges[id] = { id, state: 'skipped' };
      continue;
    }
    const touchedIndices = signals.reduce<number[]>((acc, signal, index) => {
      if (edgeTouches(id, signal)) acc.push(index);
      return acc;
    }, []);
    const lastTouch = touchedIndices.at(-1);
    let state: EdgeState = 'pending';
    if (lastTouch !== undefined) {
      const isLastSignal = lastTouch === signals.length - 1;
      state = isLastSignal && terminal === null ? 'active' : 'done';
    }
    edges[id] = { id, state };
  }
  return edges;
}

function eventRef(signal: FlowSignal): FlowEventRef {
  return {
    ...(signal.eventIndex === undefined ? {} : { eventIndex: signal.eventIndex }),
    ts: signal.ts,
    source: signal.source,
    ...(signal.tool === undefined ? {} : { tool: signal.tool }),
    message: signal.message,
    live: signal.live,
  };
}

function buildNodes(
  signals: readonly FlowSignal[],
  pathStates: Partial<Record<FlowNodeId, NodeState>>,
  overrides: Partial<Record<FlowNodeId, NodeState>>,
  ctx: SkipCtx,
): Record<FlowNodeId, FlowNode> {
  const nodes = {} as Record<FlowNodeId, FlowNode>;
  for (const id of FLOW_NODE_IDS) {
    const events = signals.filter((s) => nodesForSignal(s).includes(id)).map(eventRef);
    const state: NodeState = isNodeSkipped(id, ctx)
      ? 'skipped'
      : (overrides[id] ?? pathStates[id] ?? 'pending');
    nodes[id] = { id, state, events };
  }
  return nodes;
}

const ACTIVE_PRIORITY: readonly FlowNodeId[] = [
  'pdfAgent',
  'docxAgent',
  'orchestrator',
  'mcpGateway',
  'ucVolume',
  'ucTable',
  'trigger',
  's3',
  'browser',
];
function pickActiveNode(nodes: Record<FlowNodeId, FlowNode>): FlowNodeId | null {
  return ACTIVE_PRIORITY.find((id) => nodes[id].state === 'active') ?? null;
}

function buildEventNodeMap(persisted: readonly FlowSignal[]): Partial<Record<number, FlowNodeId>> {
  const map: Partial<Record<number, FlowNodeId>> = {};
  for (const signal of persisted) {
    const gatewayEdge = gatewayEdgeFor(signal);
    const node = gatewayEdge ? FLOW_EDGE_ENDPOINTS[gatewayEdge].to : nodesForSignal(signal)[0];
    if (node && signal.eventIndex !== undefined) map[signal.eventIndex] = node;
  }
  return map;
}

function buildSummary(
  job: Job | null,
  activeNodeId: FlowNodeId | null,
  terminal: Terminal,
): string {
  if (!job) return 'No job selected. Diagram shows the idle DocIntel architecture.';
  if (terminal === 'completed')
    return `Job ${job.fileName} completed via ${job.processor ?? 'DocIntel'}.`;
  if (terminal === 'failed') return `Job ${job.fileName} failed: ${job.error ?? 'unknown error'}.`;
  if (activeNodeId) return `Processing ${job.fileName}: ${activeNodeId} is currently active.`;
  return `Job ${job.fileName} is queued.`;
}

/** Once the agent that owns a doc type has handed its result to AWS (databricks callback for
 * PDF, `save_job_result` for DOCX), that agent node is 'done' even if the job is still PROCESSING
 * (e.g. AWS is writing the final status) — it has no more work left to do. */
function terminalAgentOverrides(
  docType: DocType | null,
  signals: readonly FlowSignal[],
  pathStates: Partial<Record<FlowNodeId, NodeState>>,
): Partial<Record<FlowNodeId, NodeState>> {
  const overrides: Partial<Record<FlowNodeId, NodeState>> = {};
  if (docType === 'pdf' && hasDatabricksCallback(signals) && pathStates.pdfAgent !== 'failed') {
    overrides.pdfAgent = 'done';
  }
  if (docType === 'docx' && hasDocxSave(signals) && pathStates.docxAgent !== 'failed') {
    overrides.docxAgent = 'done';
  }
  return overrides;
}

/** Derives every node/edge's state, plus tooltip events, from a job's trace and (in sync mode)
 * the live SSE stream. Pure and side-effect free — `FlowDiagram` only renders this output. */
export function computeFlowModel(job: Job | null, liveEvents: readonly SseEvent[] = []): FlowModel {
  const docType = job?.docType ?? null;
  const terminal = terminalOf(job);
  const { persisted, all: signals } = buildSignals(job, liveEvents);
  const path = pathFor(docType);

  const pathStates = buildPathStates(path, signals, terminal);
  const subSteps = buildSubStepStates(signals, terminal);
  const maxSubIdx = terminal === 'completed' ? PERSIST_INDEX : maxSubstepIndex(signals);
  const overrides: Partial<Record<FlowNodeId, NodeState>> = {
    mcpGateway: gatewayNodeState(signals, terminal),
    ucVolume: ucVolumeState(maxSubIdx, terminal),
    ucTable: ucTableState(maxSubIdx, hasDatabricksCallback(signals), terminal),
    ...terminalAgentOverrides(docType, signals, pathStates),
  };

  const ctx: SkipCtx = { docType };
  const nodes = buildNodes(signals, pathStates, overrides, ctx);
  const edges = buildEdges(signals, terminal, ctx);
  const activeNodeId = pickActiveNode(nodes);

  return {
    docType,
    nodes,
    edges,
    subSteps,
    activeNodeId,
    summary: buildSummary(job, activeNodeId, terminal),
    eventNodeMap: buildEventNodeMap(persisted),
  };
}
