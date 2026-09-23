import type { RouteContext } from '../context.js';
import { writeJson } from '../respond.js';

const OK_STATUS = 200;

/** `GET /health` — liveness probe, no dependencies. */
export function routeHealth(ctx: RouteContext): Promise<void> {
  writeJson(ctx.responseStream, ctx.requestId, OK_STATUS, {
    ok: true,
    service: 'api',
    ts: new Date().toISOString(),
  });
  return Promise.resolve();
}
