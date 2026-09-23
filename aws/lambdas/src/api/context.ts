import type { Writable } from 'node:stream';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ApiDeps } from './deps.js';

export interface RouteContext {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  body: string | undefined;
  responseStream: Writable;
  requestId: string;
  deps: ApiDeps;
}

function decodeBody(event: APIGatewayProxyEventV2): string | undefined {
  if (!event.body) {
    return undefined;
  }
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
}

/** Builds a {@link RouteContext} from a Lambda Function URL event (payload format 2.0). */
export function buildRouteContext(
  event: APIGatewayProxyEventV2,
  responseStream: Writable,
  requestId: string,
  deps: ApiDeps,
): RouteContext {
  return {
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.queryStringParameters ?? {},
    body: decodeBody(event),
    responseStream,
    requestId,
    deps,
  };
}
