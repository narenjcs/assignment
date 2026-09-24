import { describe, expect, it } from 'vitest';

import {
  computeFlowModel,
  FLOW_EDGE_IDS,
  FLOW_NODE_IDS,
  type EdgeState,
  type FlowEdgeId,
  type FlowModel,
  type FlowNodeId,
  type NodeState,
} from '../flow-model';
import {
  makeDocxJob,
  makeFailedPdfJob,
  makeJob,
  makePdfAsyncJob,
  makePdfSyncJob,
} from '../../tests/fixtures/job';

// Full node/edge state snapshots per scenario, keyed by id, so each test asserts the whole
// diagram at once instead of poking at individual fields (and a wrong id/typo fails loudly).
function nodeStates(model: FlowModel): Record<FlowNodeId, NodeState> {
  const entries = FLOW_NODE_IDS.map((id) => [id, model.nodes[id].state] as const);
  return Object.fromEntries(entries) as Record<FlowNodeId, NodeState>;
}
function edgeStates(model: FlowModel): Record<FlowEdgeId, EdgeState> {
  const entries = FLOW_EDGE_IDS.map((id) => [id, model.edges[id].state] as const);
  return Object.fromEntries(entries) as Record<FlowEdgeId, EdgeState>;
}

describe('computeFlowModel: no job (idle diagram)', () => {
  it('renders every node and edge as pending, with no active node', () => {
    const model = computeFlowModel(null);

    expect(nodeStates(model)).toEqual({
      browser: 'pending',
      s3: 'pending',
      trigger: 'pending',
      orchestrator: 'pending',
      docxAgent: 'pending',
      mcpGateway: 'pending',
      pdfAgent: 'pending',
      ucVolume: 'pending',
      ucTable: 'pending',
    });
    expect(edgeStates(model)).toEqual({
      browserToS3: 'pending',
      s3ToTrigger: 'pending',
      triggerToOrchestrator: 'pending',
      orchestratorToDocx: 'pending',
      orchestratorToPdf: 'pending',
      docxToGateway: 'pending',
      orchestratorToGateway: 'pending',
      pdfToGatewayCallback: 'pending',
      pdfToVolume: 'pending',
      pdfToTable: 'pending',
    });
    expect(model.activeNodeId).toBeNull();
    expect(model.eventNodeMap).toEqual({});
    expect(model.summary).toBe('No job selected. Diagram shows the idle DocIntel architecture.');
  });
});

describe('computeFlowModel: DOCX job (Databricks band skipped)', () => {
  const model = computeFlowModel(makeDocxJob());

  it('marks the AWS path done and skips every Databricks-only node', () => {
    expect(nodeStates(model)).toEqual({
      browser: 'done',
      s3: 'done',
      trigger: 'done',
      orchestrator: 'done',
      docxAgent: 'done',
      mcpGateway: 'done',
      pdfAgent: 'skipped',
      ucVolume: 'skipped',
      ucTable: 'skipped',
    });
  });

  it('skips every Databricks-only edge and lights the DOCX->gateway edge', () => {
    expect(edgeStates(model)).toEqual({
      browserToS3: 'done',
      s3ToTrigger: 'done',
      triggerToOrchestrator: 'done',
      orchestratorToDocx: 'done',
      orchestratorToPdf: 'skipped',
      docxToGateway: 'done',
      orchestratorToGateway: 'pending',
      pdfToGatewayCallback: 'skipped',
      pdfToVolume: 'skipped',
      pdfToTable: 'skipped',
    });
  });

  it('has no active node once completed, and maps events to their nodes', () => {
    expect(model.activeNodeId).toBeNull();
    expect(model.summary).toBe('Job memo.docx completed via aws-docx-agent.');
    expect(model.eventNodeMap).toEqual({
      0: 'browser',
      1: 'trigger',
      2: 'orchestrator',
      3: 'docxAgent',
      4: 'mcpGateway',
    });
  });
});

describe('computeFlowModel: PDF sync job (full pipeline + gateway callback)', () => {
  const model = computeFlowModel(makePdfSyncJob());

  it('marks every node done, including the Databricks band', () => {
    expect(nodeStates(model)).toEqual({
      browser: 'done',
      s3: 'done',
      trigger: 'done',
      orchestrator: 'done',
      docxAgent: 'skipped',
      mcpGateway: 'done',
      pdfAgent: 'done',
      ucVolume: 'done',
      ucTable: 'done',
    });
  });

  it('marks every non-DOCX edge done, including the databricks->gateway callback', () => {
    expect(edgeStates(model)).toEqual({
      browserToS3: 'done',
      s3ToTrigger: 'done',
      triggerToOrchestrator: 'done',
      orchestratorToDocx: 'skipped',
      orchestratorToPdf: 'done',
      docxToGateway: 'skipped',
      orchestratorToGateway: 'pending',
      pdfToGatewayCallback: 'done',
      pdfToVolume: 'done',
      pdfToTable: 'done',
    });
  });

  it('marks every PDF substep done and reports completion', () => {
    expect(model.subSteps).toEqual({
      ingest: 'done',
      extract: 'done',
      enrich: 'done',
      persist: 'done',
    });
    expect(model.activeNodeId).toBeNull();
    expect(model.summary).toBe('Job quarterly-report.pdf completed via databricks-pdf-agent.');
  });

  it('maps the two databricks gateway-callback events to the mcpGateway node', () => {
    expect(model.eventNodeMap).toEqual({
      0: 'browser',
      1: 'trigger',
      2: 'orchestrator',
      3: 'pdfAgent',
      4: 'pdfAgent',
      5: 'pdfAgent',
      6: 'pdfAgent',
      7: 'mcpGateway',
      8: 'mcpGateway',
    });
  });
});

describe('computeFlowModel: PDF async job (mid-pipeline)', () => {
  const model = computeFlowModel(makePdfAsyncJob());

  it('marks the ingest step active and leaves the rest of the pipeline pending', () => {
    expect(nodeStates(model)).toEqual({
      browser: 'done',
      s3: 'done',
      trigger: 'done',
      orchestrator: 'done',
      docxAgent: 'skipped',
      mcpGateway: 'pending',
      pdfAgent: 'active',
      ucVolume: 'active',
      ucTable: 'pending',
    });
    expect(model.subSteps).toEqual({
      ingest: 'active',
      extract: 'pending',
      enrich: 'pending',
      persist: 'pending',
    });
  });

  it('animates only the edge feeding the active node', () => {
    expect(edgeStates(model)).toEqual({
      browserToS3: 'done',
      s3ToTrigger: 'done',
      triggerToOrchestrator: 'done',
      orchestratorToDocx: 'skipped',
      orchestratorToPdf: 'active',
      docxToGateway: 'skipped',
      orchestratorToGateway: 'pending',
      pdfToGatewayCallback: 'pending',
      pdfToVolume: 'active',
      pdfToTable: 'pending',
    });
  });

  it('picks pdfAgent as the single active node and summarizes it as processing', () => {
    expect(model.activeNodeId).toBe('pdfAgent');
    expect(model.summary).toBe('Processing quarterly-report.pdf: pdfAgent is currently active.');
  });
});

describe('computeFlowModel: FAILED job', () => {
  const model = computeFlowModel(makeFailedPdfJob());

  it('marks the furthest-reached node failed, not the whole path', () => {
    expect(nodeStates(model)).toEqual({
      browser: 'done',
      s3: 'done',
      trigger: 'done',
      orchestrator: 'done',
      docxAgent: 'skipped',
      mcpGateway: 'failed',
      pdfAgent: 'failed',
      ucVolume: 'done',
      ucTable: 'done',
      // A failed job still froze the UC nodes to 'done' rather than leaving them 'active':
      // a terminated job never keeps animating.
    });
    expect(model.subSteps).toEqual({
      ingest: 'failed',
      extract: 'pending',
      enrich: 'pending',
      persist: 'pending',
    });
  });

  it('still shows the databricks callback edge as done: the FAILED report itself reached AWS', () => {
    expect(model.edges.pdfToGatewayCallback.state).toBe('done');
    expect(model.edges.pdfToVolume.state).toBe('done');
    expect(model.edges.pdfToTable.state).toBe('pending');
  });

  it('has no active node and reports the failure message', () => {
    expect(model.activeNodeId).toBeNull();
    expect(model.summary).toBe(
      'Job quarterly-report.pdf failed: extract failed: unreadable PDF.',
    );
  });
});

describe('computeFlowModel: gateway-tool events light the callback edge', () => {
  it('lights pdfToGatewayCallback and mcpGateway the instant a databricks event calls a gateway tool', () => {
    const job = makeJob({
      docType: 'pdf',
      status: 'PROCESSING',
      events: [
        {
          ts: '2026-01-01T00:00:00.000Z',
          source: 'databricks',
          agent: 'orchestrator',
          tool: 'update_job_status',
          message: 'Status set to PROCESSING',
        },
      ],
    });

    const model = computeFlowModel(job);

    expect(model.edges.pdfToGatewayCallback.state).toBe('active');
    expect(model.nodes.mcpGateway.state).toBe('active');
    expect(model.eventNodeMap[0]).toBe('mcpGateway');
  });

  it('does not light the callback edge for an AWS-side gateway call (docx save)', () => {
    const job = makeDocxJob({
      status: 'PROCESSING',
      events: [
        {
          ts: '2026-01-01T00:00:00.000Z',
          source: 'aws',
          agent: 'docx-agent',
          tool: 'save_job_result',
          message: 'Result saved',
        },
      ],
    });

    const model = computeFlowModel(job);

    expect(model.edges.pdfToGatewayCallback.state).toBe('skipped');
    expect(model.edges.docxToGateway.state).toBe('active');
  });
});
