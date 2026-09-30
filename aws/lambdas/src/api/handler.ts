import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { loadConfig } from '../lib/config.js';
import { NotFoundError } from '../lib/errors.js';
import { createLogger } from '../lib/log.js';
import type { RouteContext } from './context.js';
import { buildRouteContext } from './context.js';
import { buildApiDeps } from './deps.js';
import { writeErrorResponse } from './respond.js';
import { routeChat } from './routes/chat.js';
import { routeHealth } from './routes/health.js';
import { routeJobGet, routeJobProcess, routeJobsList } from './routes/jobs.js';
import { routeUploads } from './routes/uploads.js';

type Handle = (ctx: RouteContext, params: Record<string, string>) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handle: Handle;
}

// Registry/command dispatch (DEVELOPMENT.md §9) keeps the router's cyclomatic complexity
// low: matching is a single loop + regex test, never an if/else chain per route.
const ROUTES: Route[] = [
  { method: 'GET', pattern: /^\/health$/, paramNames: [], handle: routeHealth },
  { method: 'POST', pattern: /^\/uploads$/, paramNames: [], handle: routeUploads },
  { method: 'GET', pattern: /^\/jobs$/, paramNames: [], handle: routeJobsList },
  { method: 'GET', pattern: /^\/jobs\/([^/]+)$/, paramNames: ['jobId'], handle: routeJobGet },
  {
    method: 'POST',
    pattern: /^\/jobs\/([^/]+)\/process$/,
    paramNames: ['jobId'],
    handle: routeJobProcess,
  },
  { method: 'POST', pattern: /^\/chat$/, paramNames: [], handle: routeChat },
];

function matchRoute(
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | undefined {
  for (const route of ROUTES) {
    const match = route.method === method ? route.pattern.exec(path) : null;
    if (!match) {
      continue;
    }
    const params: Record<string, string> = {};
    route.paramNames.forEach((name, index) => {
      params[name] = match[index + 1] ?? '';
    });
    return { route, params };
  }
  return undefined;
}

// Clients are constructed once per module (cold start) per DEVELOPMENT.md §3.
const deps = buildApiDeps(loadConfig());
const log = createLogger('api');

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const requestId = randomUUID();
  const ctx = buildRouteContext(event as APIGatewayProxyEventV2, responseStream, requestId, deps);
  const found = matchRoute(ctx.method, ctx.path);
  const startedAt = Date.now();
  try {
    if (!found) {
      throw new NotFoundError('ROUTE_NOT_FOUND', `No route for ${ctx.method} ${ctx.path}`);
    }
    await found.route.handle(ctx, found.params);
    log.info('api_request_completed', 'API request completed', {
      requestId,
      method: ctx.method,
      path: ctx.path,
      durationMs: Date.now() - startedAt,
    });
    log.metric('ApiRequest', 1, { outcome: 'success' });
  } catch (error) {
    log.error('api_request_failed', 'API request failed', {
      requestId,
      method: ctx.method,
      path: ctx.path,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    log.metric('ApiRequest', 1, { outcome: 'failure' });
    writeErrorResponse(responseStream, requestId, error);
  }
});
