import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
import type { ApiDeps } from '../../../src/api/deps.js';
import type { RouteContext } from '../../../src/api/context.js';
import type { AgentCoreInvoker } from '../../../src/lib/agentcore.js';
import type { Config } from '../../../src/lib/config.js';
import type { JobStore } from '../../../src/lib/jobs.js';
import type { S3Helper } from '../../../src/lib/s3.js';

// Shared route-test fixtures: a fully-typed fake ApiDeps (every method a vi.fn stub the test
// configures) plus a minimal RouteContext builder, so each route test only wires the handful
// of deps methods it actually exercises (Handler -> Service -> Adapter DI, DEVELOPMENT.md §9).

export const TEST_CONFIG: Config = {
  AWS_REGION: 'us-east-1',
  JOBS_TABLE: 'test-jobs',
  UPLOADS_BUCKET: 'test-uploads',
  ORCHESTRATOR_ARN: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test',
  PRESIGN_TTL_SECONDS: 900,
  JOB_TTL_DAYS: 7,
};

export function fakeJobStore(overrides: Partial<JobStore> = {}): JobStore {
  return {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    updateStatus: vi.fn(),
    appendEvent: vi.fn(),
    saveResult: vi.fn(),
    fail: vi.fn(),
    ...overrides,
  };
}

export function fakeS3Helper(overrides: Partial<S3Helper> = {}): S3Helper {
  return {
    presignUpload: vi.fn(),
    presignDownload: vi.fn(),
    getObjectBytes: vi.fn(),
    putJson: vi.fn(),
    headObject: vi.fn(),
    ...overrides,
  };
}

export function fakeAgentCore(overrides: Partial<AgentCoreInvoker> = {}): AgentCoreInvoker {
  return { invoke: vi.fn(), ...overrides };
}

export function fakeApiDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    config: TEST_CONFIG,
    jobStore: fakeJobStore(),
    s3Helper: fakeS3Helper(),
    agentCore: fakeAgentCore(),
    ...overrides,
  };
}

export interface TestRouteContext extends RouteContext {
  chunks: Buffer[];
}

/** Builds a RouteContext over a real PassThrough (so writeJson/openSseStream work unmodified),
 * collecting every written chunk on `.chunks` for the test to inspect. */
export function buildTestContext(overrides: Partial<RouteContext> = {}): TestRouteContext {
  const responseStream = new PassThrough();
  const chunks: Buffer[] = [];
  responseStream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ctx: RouteContext = {
    method: 'GET',
    path: '/',
    query: {},
    body: undefined,
    responseStream,
    requestId: 'req-test',
    deps: fakeApiDeps(),
    ...overrides,
  };
  return Object.assign(ctx, { chunks });
}

export function writtenText(ctx: TestRouteContext): string {
  return Buffer.concat(ctx.chunks).toString('utf-8');
}
