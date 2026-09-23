import { buildRuntimeSessionId } from '../../lib/agentcore.js';
import { NotFoundError } from '../../lib/errors.js';
import type { RouteContext } from '../context.js';
import { openSseStream } from '../respond.js';
import { proxyAgentCoreStream } from '../stream-proxy.js';
import { chatBodySchema, parseJsonBody } from './schemas.js';

/**
 * `POST /chat` — streams a grounded follow-up answer for an already-processed job
 * (PLAN §2.2 step 7). The session id defaults to `{jobId}-chat` so a browser can omit
 * `sessionId` on the first turn and reuse the one returned by the orchestrator after.
 */
export async function routeChat(ctx: RouteContext): Promise<void> {
  const body = parseJsonBody(chatBodySchema, ctx.body);
  const job = await ctx.deps.jobStore.get(body.jobId);
  if (!job) {
    throw new NotFoundError('JOB_NOT_FOUND', `Job ${body.jobId} not found`);
  }
  const stream = openSseStream(ctx.responseStream, ctx.requestId);
  await proxyAgentCoreStream(
    ctx.deps.agentCore,
    {
      sessionId: body.sessionId ?? buildRuntimeSessionId(job.jobId, 'chat'),
      payload: { jobId: job.jobId, mode: 'chat', message: body.message },
      accept: 'text/event-stream',
    },
    stream,
    job.jobId,
  );
}
