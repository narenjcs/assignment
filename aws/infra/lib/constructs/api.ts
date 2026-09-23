import * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface ApiProps {
  readonly apiFunction: nodejs.NodejsFunction;
}

/**
 * The public HTTP entry point (PLAN.md §3 item API; TASKS T4.4): a Lambda Function URL with no
 * auth (the demo has no API-level auth in front of it — see PLAN.md §2.5) and streaming enabled,
 * since `aws/lambdas/src/api/handler.ts` uses `awslambda.streamifyResponse(...)` to stream SSE
 * job-progress events back to the browser.
 */
export class Api extends Construct {
  readonly functionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);
    this.functionUrl = props.apiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
        exposedHeaders: ['x-request-id'],
      },
    });
  }
}
