// Pure events -> node-state mapping for the live agent-flow diagram (UI-PLAN.md §1).
// No React here; `components/FlowDiagram.tsx` only renders what this module computes.
// Topology mirrors PLAN.md §2's Mermaid diagram; the event->node rules mirror the real
// agent/tool names emitted by aws/lambdas, aws/agents, and databricks/app (see each node's
// comment below for the source line it was read from).

import type { DocType, EventSource, Job, JobEvent } from '../types/job';
import type { SseEvent } from '../types/sse';

export const FLOW_NODE_IDS = [
  'browser',
  's3',
  'trigger',
  'orchestrator',
  'docxAgent',
  'mcpGateway',
  'pdfAgent',
  'ucVolume',
  'ucTable',
] as const;
export type FlowNodeId = (typeof FLOW_NODE_IDS)[number];

export const PDF_SUBSTEPS = ['ingest', 'extract', 'enrich', 'persist'] as const;
export type PdfSubStep = (typeof PDF_SUBSTEPS)[number];

export const FLOW_EDGE_IDS = [
  'browserToS3',
  's3ToTrigger',
  'triggerToOrchestrator',
  'orchestratorToDocx',
  'orchestratorToPdf',
  'docxToGateway',
  'orchestratorToGateway',
  'pdfToGatewayCallback',
  'pdfToVolume',
  'pdfToTable',
] as const;
export type FlowEdgeId = (typeof FLOW_EDGE_IDS)[number];

/** Single source of truth for diagram topology; the SVG component only supplies coordinates. */
export const FLOW_EDGE_ENDPOINTS: Record<FlowEdgeId, { from: FlowNodeId; to: FlowNodeId }> = {
  browserToS3: { from: 'browser', to: 's3' },
  s3ToTrigger: { from: 's3', to: 'trigger' },
  triggerToOrchestrator: { from: 'trigger', to: 'orchestrator' },
  orchestratorToDocx: { from: 'orchestrator', to: 'docxAgent' },
  orchestratorToPdf: { from: 'orchestrator', to: 'pdfAgent' },
  docxToGateway: { from: 'docxAgent', to: 'mcpGateway' },
  orchestratorToGateway: { from: 'orchestrator', to: 'mcpGateway' },
  pdfToGatewayCallback: { from: 'pdfAgent', to: 'mcpGateway' },
  pdfToVolume: { from: 'pdfAgent', to: 'ucVolume' },
  pdfToTable: { from: 'pdfAgent', to: 'ucTable' },
};

export type NodeState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';
export type EdgeState = 'pending' | 'active' | 'done' | 'skipped';
type Terminal = 'completed' | 'failed' | null;

export interface FlowEventRef {
  /** Index into `job.events`; absent for a live SSE frame not yet persisted. */
  eventIndex?: number;
  ts: string;
  source: EventSource;
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
  /** Visually-hidden textual summary of the current stage (UI-PLAN §1 "Interaction"). */
  summary: string;
  /** `job.events[]` index -> the node it primarily lit up, for trace<->diagram wiring. */
  eventNodeMap: Partial<Record<number, FlowNodeId>>;
}

// The AWS Gateway's 7 tools (PLAN.md §2.7 / aws/lambdas/tools.json) — an event whose `tool`
// is one of these is an MCP call into the AWS Gateway, wherever it originated.
const GATEWAY_TOOLS = [
  'get_job',
  'list_jobs',
  'update_job_status',
  'append_job_event',
  'save_job_result',
  'extract_docx_text',
  'get_download_url',
] as const;

const DOCX_PATH: readonly FlowNodeId[] = ['browser', 's3', 'trigger', 'orchestrator', 'docxAgent'];
const PDF_PATH: readonly FlowNodeId[] = ['browser', 's3', 'trigger', 'orchestrator', 'pdfAgent'];
const INGEST_INDEX = 0;
const PERSIST_INDEX = 3;

interface FlowSignal {
  source: EventSource;
  agent: string;
  tool?: string;
  message: string;
  ts: string;
  eventIndex?: number;
  live: boolean;
}

function asEventSource(value: string | undefined): EventSource {
  return value === 'aws' || value === 'databricks' ? value : 'orchestrator';
}

function fromJobEvents(events: readonly JobEvent[]): FlowSignal[] {
  return events.map((event, index) => ({
    source: event.source,
    agent: event.agent,
    tool: event.tool,
    message: event.message,
    ts: event.ts,
    eventIndex: index,
    live: false,
  }));
}

/** Live SSE frames only carry flow-relevant info on `status`/`tool` types (PLAN.md §2.6). */
function fromLiveEvents(liveEvents: readonly SseEvent[]): FlowSignal[] {
  const signals: FlowSignal[] = [];
  for (const frame of liveEvents) {
    if (frame.type === 'status') {
      signals.push({
        source: asEventSource(frame.source),
        agent: frame.agent ?? 'orchestrator',
        message: frame.message ?? frame.status,
        ts: frame.ts,
        live: true,
      });
    } else if (frame.type === 'tool') {
      signals.push({
        source: frame.source,
        agent: frame.agent ?? 'orchestrator',
        tool: frame.name,
        message: frame.summary ?? `${frame.name} ${frame.phase}`,
        ts: frame.ts,
        live: true,
      });
    }
  }
  return signals;
}

function pdfSubStepOf(signal: FlowSignal): PdfSubStep | null {
  if (signal.source !== 'databricks' || signal.tool === undefined) return null;
  const steps: readonly string[] = PDF_SUBSTEPS;
  return steps.includes(signal.tool) ? (signal.tool as PdfSubStep) : null;
}

function isGatewaySignal(signal: FlowSignal): boolean {
  const tools: readonly string[] = GATEWAY_TOOLS;
  return signal.tool !== undefined && tools.includes(signal.tool);
}

const AGENT_NODE: Partial<Record<string, FlowNodeId>> = {
  'docx-agent': 'docxAgent',
  's3-trigger': 'trigger',
};

/** Which node(s) a signal lights up (aws/lambdas/src/lib/jobs.ts, s3-trigger/handler.ts,
 * aws/agents/*, databricks/app/src/docintel_app/agent.py — see module docstring). */
function nodesForSignal(signal: FlowSignal): FlowNodeId[] {
  if (pdfSubStepOf(signal)) return ['pdfAgent'];
  if (signal.agent === 'api' && signal.tool === 'create_job') return ['browser', 's3'];
  const mapped = AGENT_NODE[signal.agent];
  if (mapped) return [mapped];
  if (signal.agent === 'api') return ['trigger'];
  if (signal.source === 'databricks') return ['pdfAgent'];
  if (signal.agent === 'orchestrator' || signal.source === 'orchestrator') return ['orchestrator'];
  return [];
}

/** Which gateway edge a gateway-tool call lights up: the databricks case is the callback edge
 * that proves the cross-cloud MCP hop (UI-PLAN §1 "the single most important thing"). */
function gatewayEdgeFor(signal: FlowSignal): FlowEdgeId | null {
  if (!isGatewaySignal(signal)) return null;
  if (signal.source === 'databricks') return 'pdfToGatewayCallback';
  if (signal.agent === 'docx-agent') return 'docxToGateway';
  if (signal.agent === 'orchestrator') return 'orchestratorToGateway';
  return null;
}

function edgeTouches(id: FlowEdgeId, signal: FlowSignal): boolean {
  const gatewayEdge = gatewayEdgeFor(signal);
  if (gatewayEdge) return gatewayEdge === id;
  const step = pdfSubStepOf(signal);
  if (step === 'ingest' && id === 'pdfToVolume') return true;
  if (step === 'persist' && id === 'pdfToTable') return true;
  return nodesForSignal(signal).includes(FLOW_EDGE_ENDPOINTS[id].to);
}

function terminalOf(job: Job | null): Terminal {
  if (job?.status === 'COMPLETED') return 'completed';
  if (job?.status === 'FAILED') return 'failed';
  return null;
}

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
    for (const nodeId of nodesForSignal(signal)) {
      const idx = path.indexOf(nodeId);
      if (idx > max) max = idx;
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

function buildSubStepStates(signals: readonly FlowSignal[], terminal: Terminal): Record<PdfSubStep, NodeState> {
  const rawMax = maxSubstepIndex(signals);
  const maxIndex = terminal === 'completed' ? PDF_SUBSTEPS.length - 1 : rawMax;
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

function ucVolumeState(maxSubIdx: number, terminal: Terminal): NodeState {
  if (terminal === 'completed') return 'done';
  if (maxSubIdx < INGEST_INDEX) return 'pending';
  if (terminal === 'failed' && maxSubIdx === INGEST_INDEX) return 'failed';
  return maxSubIdx > INGEST_INDEX ? 'done' : 'active';
}

function ucTableState(maxSubIdx: number, callbackSeen: boolean, terminal: Terminal): NodeState {
  if (terminal === 'completed') return 'done';
  if (maxSubIdx < PERSIST_INDEX) return 'pending';
  if (terminal === 'failed') return 'failed';
  return callbackSeen ? 'done' : 'active';
}

function gatewayNodeState(signals: readonly FlowSignal[], terminal: Terminal): NodeState {
  let lastTouch = -1;
  signals.forEach((s, i) => {
    if (isGatewaySignal(s)) lastTouch = i;
  });
  if (lastTouch === -1) return 'pending';
  if (terminal === 'failed') return lastTouch === signals.length - 1 ? 'failed' : 'done';
  if (terminal === 'completed') return 'done';
  return lastTouch === signals.length - 1 ? 'active' : 'done';
}

interface SkipCtx {
  docType: DocType | null;
}

const DATABRICKS_NODES: readonly FlowNodeId[] = ['pdfAgent', 'ucVolume', 'ucTable'];
const DATABRICKS_EDGES: readonly FlowEdgeId[] = [
  'orchestratorToPdf',
  'pdfToGatewayCallback',
  'pdfToVolume',
  'pdfToTable',
];
const DOCX_ONLY_EDGES: readonly FlowEdgeId[] = ['orchestratorToDocx', 'docxToGateway'];

function isNodeSkipped(id: FlowNodeId, ctx: SkipCtx): boolean {
  if (ctx.docType === null) return false;
  if (ctx.docType === 'docx') return DATABRICKS_NODES.includes(id);
  return id === 'docxAgent';
}

function isEdgeSkipped(id: FlowEdgeId, ctx: SkipCtx): boolean {
  if (ctx.docType === null) return false;
  if (ctx.docType === 'docx') return DATABRICKS_EDGES.includes(id);
  return DOCX_ONLY_EDGES.includes(id);
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
    let lastTouch = -1;
    signals.forEach((signal, index) => {
      if (edgeTouches(id, signal)) lastTouch = index;
    });
    const state: EdgeState =
      lastTouch === -1
        ? 'pending'
        : terminal !== null || lastTouch !== signals.length - 1
          ? 'done'
          : 'active';
    edges[id] = { id, state };
  }
  return edges;
}

function eventRef(signal: FlowSignal): FlowEventRef {
  const ref: FlowEventRef = {
    ts: signal.ts,
    source: signal.source,
    message: signal.message,
    live: signal.live,
  };
  if (signal.tool !== undefined) ref.tool = signal.tool;
  if (signal.eventIndex !== undefined) ref.eventIndex = signal.eventIndex;
  return ref;
}

function buildNodes(
  signals: readonly FlowSignal[],
  pathStates: Partial<Record<FlowNodeId, NodeState>>,
  overrides: Partial<Record<FlowNodeId, NodeState>>,
  ctx: SkipCtx,
): Record<FlowNodeId, FlowNode> {
  const nodes = {} as Record<FlowNodeId, FlowNode>;
  for (const id of FLOW_NODE_IDS) {
    const events = signals.filter((signal) => nodesForSignal(signal).includes(id)).map(eventRef);
    const skipped = isNodeSkipped(id, ctx);
    const state = skipped ? 'skipped' : (overrides[id] ?? pathStates[id] ?? 'pending');
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

function buildEventNodeMap(signals: readonly FlowSignal[]): Partial<Record<number, FlowNodeId>> {
  const map: Partial<Record<number, FlowNodeId>> = {};
  for (const signal of signals) {
    if (signal.eventIndex === undefined) continue;
    const [first] = nodesForSignal(signal);
    if (first) map[signal.eventIndex] = first;
  }
  return map;
}

function buildSummary(job: Job | null, activeNodeId: FlowNodeId | null, terminal: Terminal): string {
  if (!job) return 'No job selected. Diagram shows the idle DocIntel architecture.';
  if (terminal === 'completed') return `Job ${job.fileName} completed via ${job.processor ?? 'DocIntel'}.`;
  if (terminal === 'failed') return `Job ${job.fileName} failed: ${job.error ?? 'unknown error'}.`;
  if (activeNodeId) return `Processing ${job.fileName}: ${activeNodeId} is currently active.`;
  return `Job ${job.fileName} is queued.`;
}

/** Derives every node/edge's state, plus tooltip events, from a job's trace and (in sync mode)
 * the live SSE stream. Pure and side-effect free — `FlowDiagram` only renders this output. */
export function computeFlowModel(job: Job | null, liveEvents: readonly SseEvent[] = []): FlowModel {
  const docType = job?.docType ?? null;
  const terminal = terminalOf(job);
  const persisted = job ? fromJobEvents(job.events) : [];
  const signals = [...persisted, ...fromLiveEvents(liveEvents)];
  const path = docType === 'docx' ? DOCX_PATH : PDF_PATH;

  const pathStates = buildPathStates(path, signals, terminal);
  const subSteps = buildSubStepStates(signals, terminal);
  const maxSubIdx = terminal === 'completed' ? PERSIST_INDEX : maxSubstepIndex(signals);
  const overrides: Partial<Record<FlowNodeId, NodeState>> = {
    mcpGateway: gatewayNodeState(signals, terminal),
    ucVolume: ucVolumeState(maxSubIdx, terminal),
    ucTable: ucTableState(maxSubIdx, hasDatabricksCallback(signals), terminal),
  };
  if (docType === 'pdf' && hasDatabricksCallback(signals) && pathStates.pdfAgent !== 'failed') {
    overrides.pdfAgent = 'done';
  }
  if (docType === 'docx' && hasDocxSave(signals) && pathStates.docxAgent !== 'failed') {
    overrides.docxAgent = 'done';
  }

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
