import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { Naming } from './naming.js';
import { JOB_TTL_DAYS_STRING } from '../constants.js';

const PRESIGN_TTL_SECONDS = '900';
const MCP_TOOLS_TIMEOUT = Duration.minutes(2);
const S3_TRIGGER_TIMEOUT = Duration.minutes(5);
/** Caps concurrent invocations of the public, unauthenticated api Function URL (review round 1,
 * item 6) — bounds the blast radius/cost of abuse without adding auth, which PLAN.md §2.5 marks
 * out of scope for this demo. Flagged in the review-round-1 report for sign-off. */
const API_RESERVED_CONCURRENCY = 20;

/** Env vars every Lambda needs regardless of handler (aws/lambdas/src/lib/config.ts). */
function baseEnvironment(jobsTable: dynamodb.Table): Record<string, string> {
  return {
    JOBS_TABLE: jobsTable.tableName,
    PRESIGN_TTL_SECONDS,
    JOB_TTL_DAYS: JOB_TTL_DAYS_STRING,
    LOG_LEVEL: 'info',
  };
}

function bundling(): nodejs.BundlingOptions {
  return {
    format: nodejs.OutputFormat.ESM,
    minify: true,
    sourceMap: true,
    target: 'node22',
    // esbuild emits ESM, but bundled CommonJS dependencies (e.g. `mammoth`, used for DOCX text)
    // still call `require(...)` at load time, which ESM has no definition for — the function then
    // dies at INIT with `Dynamic require of "fs" is not supported`. This banner recreates a
    // working `require` from the module URL so those dependencies load. Verified against a real
    // deploy: without it the mcp-tools function fails every invocation.
    banner:
      "import{createRequire as __docintelCreateRequire}from'node:module';" +
      'const require=__docintelCreateRequire(import.meta.url);',
  };
}

export interface McpToolsFunctionProps {
  readonly naming: Naming;
  readonly lambdasDir: string;
  readonly jobsTable: dynamodb.Table;
  readonly uploadsBucket: s3.Bucket;
}

/**
 * The `mcp-tools` Lambda (PLAN.md §3 item Lambdas; TASKS T2.8): implements the 7 MCP tools in
 * `aws/lambdas/tools.json`. Built ahead of the Gateway/Runtimes because the Gateway needs it as
 * a target (`aws/lambdas/src/mcp-tools/deps.ts` needs no `ORCHESTRATOR_ARN`).
 */
export class McpToolsFunction extends Construct {
  readonly function: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: McpToolsFunctionProps) {
    super(scope, id);
    this.function = new nodejs.NodejsFunction(this, 'Function', {
      functionName: props.naming.resource('mcp-tools'),
      entry: `${props.lambdasDir}/src/mcp-tools/handler.ts`,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: MCP_TOOLS_TIMEOUT,
      bundling: bundling(),
      environment: {
        ...baseEnvironment(props.jobsTable),
        UPLOADS_BUCKET: props.uploadsBucket.bucketName,
      },
    });
    props.jobsTable.grantReadWriteData(this.function);
    props.uploadsBucket.grantReadWrite(this.function);
  }
}

export interface AppLambdasProps {
  readonly naming: Naming;
  readonly lambdasDir: string;
  readonly jobsTable: dynamodb.Table;
  readonly uploadsBucket: s3.Bucket;
  readonly orchestratorRuntime: agentcore.Runtime;
}

/**
 * The `api` and `s3-trigger` Lambdas (TASKS T2.8). Both need `ORCHESTRATOR_ARN`
 * (`aws/lambdas/src/api/deps.ts` and `src/s3-trigger/deps.ts` throw without it), so they can
 * only be built once the orchestrator `Runtime` exists — after the Gateway. The `s3-trigger`
 * handler never reads object bytes (`buildS3TriggerDeps` builds no `S3Client`), so it gets no
 * bucket IAM grant, only table + invoke grants.
 */
export class AppLambdas extends Construct {
  readonly apiFunction: nodejs.NodejsFunction;
  readonly s3TriggerFunction: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: AppLambdasProps) {
    super(scope, id);
    this.apiFunction = this.buildApiFunction(props);
    this.s3TriggerFunction = this.buildS3TriggerFunction(props);
    this.grantPermissions(props);
  }

  private buildApiFunction(props: AppLambdasProps): nodejs.NodejsFunction {
    return new nodejs.NodejsFunction(this, 'ApiFunction', {
      functionName: props.naming.resource('api'),
      entry: `${props.lambdasDir}/src/api/handler.ts`,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: Duration.minutes(15),
      bundling: bundling(),
      // No auth in front of this Function URL (PLAN.md §2.5, out of scope for the demo) — reserved
      // concurrency caps the blast radius of unauthenticated abuse instead.
      reservedConcurrentExecutions: API_RESERVED_CONCURRENCY,
      environment: {
        ...baseEnvironment(props.jobsTable),
        UPLOADS_BUCKET: props.uploadsBucket.bucketName,
        ORCHESTRATOR_ARN: props.orchestratorRuntime.agentRuntimeArn,
      },
    });
  }

  private buildS3TriggerFunction(props: AppLambdasProps): nodejs.NodejsFunction {
    return new nodejs.NodejsFunction(this, 'S3TriggerFunction', {
      functionName: props.naming.resource('s3-trigger'),
      entry: `${props.lambdasDir}/src/s3-trigger/handler.ts`,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: S3_TRIGGER_TIMEOUT,
      bundling: bundling(),
      environment: {
        ...baseEnvironment(props.jobsTable),
        UPLOADS_BUCKET: props.uploadsBucket.bucketName,
        ORCHESTRATOR_ARN: props.orchestratorRuntime.agentRuntimeArn,
      },
    });
  }

  private grantPermissions(props: AppLambdasProps): void {
    props.jobsTable.grantReadWriteData(this.apiFunction);
    props.uploadsBucket.grantReadWrite(this.apiFunction);
    props.orchestratorRuntime.grantInvoke(this.apiFunction);

    props.jobsTable.grantReadWriteData(this.s3TriggerFunction);
    props.orchestratorRuntime.grantInvoke(this.s3TriggerFunction);
  }
}
