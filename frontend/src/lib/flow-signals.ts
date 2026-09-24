// Event interpretation layer for the live agent-flow diagram (UI-PLAN.md §1): topology
// (node/edge ids) plus the pure rules that map one job event or live SSE frame onto the
// node(s)/edge it lights up. `flow-model.ts` turns a *sequence* of these into node/edge state;
// this module only knows what a single signal means.
//
// The event->node rules mirror the real agent/tool names emitted by the backend:
//  - {source:'aws', agent:'api', tool:'create_job'}        aws/lambdas/src/lib/jobs.ts:96
//  - {source:'aws', agent:'s3-trigger', tool:'s3:...'}      aws/lambdas/src/s3-trigger/handler.ts
//  - {source:'aws', agent:'api', tool:'s3:HeadObject'}      aws/lambdas/src/api/routes/jobs.ts:68
//  - {source:'orchestrator', agent:'orchestrator'}          aws/agents/orchestrator/workflow.py:30
//  - {source:'aws', agent:'docx-agent'}                     aws/agents/docx_agent/enrich.py:19
//  - {source:'databricks', tool:'ingest'|'extract'|...}     databricks/app/.../agent.py `_step`
//  - {source:'databricks', tool:'update_job_status'|'save_job_result'} databricks agent.py
//    (databricks calling an AWS Gateway tool by name — the cross-cloud callback)

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

// The AWS Gateway's 7 tools (PLAN.md §2.7 / aws/lambdas/tools.json) — an event whose `tool`
// is one of these is an MCP call into the AWS Gateway, wherever it originated.
export const GATEWAY_TOOLS = [
  'get_job',
  'list_jobs',
  'update_job_status',
  'append_job_event',
  'save_job_result',
  'extract_docx_text',
  'get_download_url',
] as const;

export const DOCX_PATH: readonly FlowNodeId[] = [
  'browser',
  's3',
  'trigger',
  'orchestrator',
  'docxAgent',
];
export const PDF_PATH: readonly FlowNodeId[] = [
  'browser',
  's3',
  'trigger',
  'orchestrator',
  'pdfAgent',
];

export interface FlowSignal {
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
    ...(event.tool === undefined ? {} : { tool: event.tool }),
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

/** Builds the persisted signals (from `job.events`) and the combined persisted+live sequence
 * used for state derivation. Kept separate so trace<->diagram wiring can key off `job.events`
 * indices alone, even while a live stream is also in flight. */
export function buildSignals(
  job: Job | null,
  liveEvents: readonly SseEvent[],
): { persisted: FlowSignal[]; all: FlowSignal[] } {
  const persisted = job ? fromJobEvents(job.events) : [];
  return { persisted, all: [...persisted, ...fromLiveEvents(liveEvents)] };
}

export function pdfSubStepOf(signal: FlowSignal): PdfSubStep | null {
  if (signal.source !== 'databricks' || signal.tool === undefined) return null;
  const steps: readonly string[] = PDF_SUBSTEPS;
  return steps.includes(signal.tool) ? (signal.tool as PdfSubStep) : null;
}

export function isGatewaySignal(signal: FlowSignal): boolean {
  const tools: readonly string[] = GATEWAY_TOOLS;
  return signal.tool !== undefined && tools.includes(signal.tool);
}

const AGENT_NODE: Partial<Record<string, FlowNodeId>> = {
  'docx-agent': 'docxAgent',
  's3-trigger': 'trigger',
};

/** Which node(s) a signal lights up. */
export function nodesForSignal(signal: FlowSignal): FlowNodeId[] {
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
export function gatewayEdgeFor(signal: FlowSignal): FlowEdgeId | null {
  if (!isGatewaySignal(signal)) return null;
  if (signal.source === 'databricks') return 'pdfToGatewayCallback';
  if (signal.agent === 'docx-agent') return 'docxToGateway';
  if (signal.agent === 'orchestrator') return 'orchestratorToGateway';
  return null;
}

export function edgeTouches(id: FlowEdgeId, signal: FlowSignal): boolean {
  const gatewayEdge = gatewayEdgeFor(signal);
  if (gatewayEdge) return gatewayEdge === id;
  const step = pdfSubStepOf(signal);
  if (step === 'ingest' && id === 'pdfToVolume') return true;
  if (step === 'persist' && id === 'pdfToTable') return true;
  return nodesForSignal(signal).includes(FLOW_EDGE_ENDPOINTS[id].to);
}

export function pathFor(docType: DocType | null): readonly FlowNodeId[] {
  return docType === 'docx' ? DOCX_PATH : PDF_PATH;
}

// Which nodes/edges belong exclusively to one cloud band, so the *other* doc type's job can
// skip (grey out) that whole band (UI-PLAN §1: "DOCX jobs skip the Databricks band, and PDF
// jobs skip the DOCX agent, entirely").
export interface SkipCtx {
  docType: DocType | null;
}
const DATABRICKS_NODES: readonly FlowNodeId[] = ['pdfAgent', 'ucVolume', 'ucTable'];
const DATABRICKS_EDGES: readonly FlowEdgeId[] = [
  'orchestratorToPdf',
  'pdfToGatewayCallback',
  'pdfToVolume',
  'pdfToTable',
];
const DOCX_ONLY_NODES: readonly FlowNodeId[] = ['docxAgent'];
const DOCX_ONLY_EDGES: readonly FlowEdgeId[] = ['orchestratorToDocx', 'docxToGateway'];

export function isNodeSkipped(id: FlowNodeId, ctx: SkipCtx): boolean {
  if (ctx.docType === 'docx') return DATABRICKS_NODES.includes(id);
  if (ctx.docType === 'pdf') return DOCX_ONLY_NODES.includes(id);
  return false;
}
export function isEdgeSkipped(id: FlowEdgeId, ctx: SkipCtx): boolean {
  if (ctx.docType === 'docx') return DATABRICKS_EDGES.includes(id);
  if (ctx.docType === 'pdf') return DOCX_ONLY_EDGES.includes(id);
  return false;
}
