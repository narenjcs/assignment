import { describe, expect, it } from 'vitest';
import { routeChat } from '../../../src/api/routes/chat.js';
import { NotFoundError } from '../../../src/lib/errors.js';
import type { AgentCoreInvoker, InvokeInput, InvokeResult } from '../../../src/lib/agentcore.js';
import type { Job } from '../../../src/lib/types.js';
import { buildTestContext, fakeAgentCore, fakeJobStore, writtenText } from './helpers.js';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
// AgentCore requires runtimeSessionId to be >= 33 chars (see lib/agentcore.ts).
const CUSTOM_SESSION_ID = `custom-session-${'0'.repeat(25)}`;

function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    jobId: JOB_ID,
    entity: 'JOB',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    fileName: 'report.pdf',
    contentType: 'application/pdf',
    docType: 'pdf',
    s3Key: `uploads/sync/${JOB_ID}/report.pdf`,
    mode: 'sync',
    status: 'COMPLETED',
    events: [],
    ttl: 0,
    ...overrides,
  };
}

describe('routeChat', () => {
  it('opens an SSE stream and proxies the orchestrator response, defaulting sessionId to {jobId}-chat', async () => {
    const job = jobFixture();
    const jobStore = fakeJobStore({ get: () => Promise.resolve(job) });
    let receivedInput: InvokeInput | undefined;
    const invoke: AgentCoreInvoker['invoke'] = (input): Promise<InvokeResult> => {
      receivedInput = input;
      return Promise.resolve({
        contentType: 'text/event-stream',
        statusCode: 200,
        response: undefined,
      });
    };
    const agentCore = fakeAgentCore({ invoke });
    const ctx = buildTestContext({
      method: 'POST',
      path: '/chat',
      body: JSON.stringify({ jobId: JOB_ID, message: 'What is the total?' }),
      deps: { ...buildTestContext().deps, jobStore, agentCore },
    });

    await routeChat(ctx);

    expect(receivedInput?.sessionId).toBe(`${JOB_ID}-chat`);
    expect(writtenText(ctx)).toContain('"type":"done"');
    expect(writtenText(ctx)).toContain(`"jobId":"${JOB_ID}"`);
  });

  it('uses an explicit sessionId when the caller provides one', async () => {
    const job = jobFixture();
    const jobStore = fakeJobStore({ get: () => Promise.resolve(job) });
    let receivedInput: InvokeInput | undefined;
    const invoke: AgentCoreInvoker['invoke'] = (input): Promise<InvokeResult> => {
      receivedInput = input;
      return Promise.resolve({
        contentType: 'text/event-stream',
        statusCode: 200,
        response: undefined,
      });
    };
    const agentCore = fakeAgentCore({ invoke });
    const ctx = buildTestContext({
      method: 'POST',
      path: '/chat',
      body: JSON.stringify({
        jobId: JOB_ID,
        message: 'And the subtotal?',
        sessionId: CUSTOM_SESSION_ID,
      }),
      deps: { ...buildTestContext().deps, jobStore, agentCore },
    });

    await routeChat(ctx);

    expect(receivedInput?.sessionId).toBe(CUSTOM_SESSION_ID);
  });

  it('throws NotFoundError (404) when the job does not exist', async () => {
    const jobStore = fakeJobStore({ get: () => Promise.resolve(undefined) });
    const ctx = buildTestContext({
      method: 'POST',
      path: '/chat',
      body: JSON.stringify({ jobId: JOB_ID, message: 'hi' }),
      deps: { ...buildTestContext().deps, jobStore },
    });

    await expect(routeChat(ctx)).rejects.toThrow(NotFoundError);
  });
});
