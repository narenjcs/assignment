import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { resolveAssetPaths, type AssetPaths } from './asset-paths.js';
import { writeOutputs } from './outputs.js';
import { createNaming, type Naming } from './constructs/naming.js';
import { Storage } from './constructs/storage.js';
import { JobsTable } from './constructs/jobs-table.js';
import { Auth } from './constructs/auth.js';
import { McpToolsFunction, AppLambdas } from './constructs/lambdas.js';
import { Gateway } from './constructs/gateway.js';
import { Runtimes } from './constructs/runtimes.js';
import { Api } from './constructs/api.js';
import { Web } from './constructs/web.js';

export interface DocIntelStackProps extends StackProps {
  readonly modelId: string;
  readonly stage: string;
  readonly lambdasDir?: string;
  readonly toolsJsonPath?: string;
  readonly docxAgentZipPath?: string;
  readonly orchestratorZipPath?: string;
  readonly frontendDistPath?: string;
}

/** Everything the private `buildXxx` helpers below need but don't construct themselves. */
interface BuildContext {
  readonly naming: Naming;
  readonly paths: AssetPaths;
  readonly modelId: string;
}

/**
 * DocIntel's single deployable stack (DEVELOPMENT.md §2, PLAN.md §3): wires every construct in
 * dependency order — storage/table/auth first, then the mcp-tools Lambda (needed by the
 * Gateway), the Gateway, the two AgentCore Runtimes (need the Gateway URL), the api/s3-trigger
 * Lambdas (need the orchestrator Runtime ARN), the S3 -> s3-trigger notification, and finally
 * the web deployment (needs the api URL). Composition only — no resource logic lives here.
 */
export class DocIntelStack extends Stack {
  constructor(scope: Construct, id: string, props: DocIntelStackProps) {
    super(scope, id, props);

    const ctx: BuildContext = {
      naming: createNaming({ stage: props.stage, account: this.account }),
      paths: resolveAssetPaths(props),
      modelId: props.modelId,
    };

    const storage = new Storage(this, 'Storage', { naming: ctx.naming });
    const jobsTable = new JobsTable(this, 'JobsTable', { naming: ctx.naming });
    const auth = new Auth(this, 'Auth', { naming: ctx.naming });

    const mcpTools = this.buildMcpTools(ctx, jobsTable, storage);
    const gateway = this.buildGateway(ctx, auth, mcpTools);
    const runtimes = this.buildRuntimes(ctx, gateway, auth);
    const appLambdas = this.buildAppLambdas(ctx, jobsTable, storage, runtimes);

    storage.uploadsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(appLambdas.s3TriggerFunction),
      { prefix: 'uploads/' },
    );

    const api = new Api(this, 'Api', { apiFunction: appLambdas.apiFunction });
    new Web(this, 'Web', {
      webBucket: storage.webBucket,
      distribution: storage.distribution,
      frontendDistPath: ctx.paths.frontendDistPath,
      apiUrl: api.functionUrl.url,
    });

    writeOutputs(this, { storage, jobsTable, auth, gateway, runtimes, api });
  }

  private buildMcpTools(
    ctx: BuildContext,
    jobsTable: JobsTable,
    storage: Storage,
  ): McpToolsFunction {
    return new McpToolsFunction(this, 'McpTools', {
      naming: ctx.naming,
      lambdasDir: ctx.paths.lambdasDir,
      jobsTable: jobsTable.table,
      uploadsBucket: storage.uploadsBucket,
    });
  }

  private buildGateway(ctx: BuildContext, auth: Auth, mcpTools: McpToolsFunction): Gateway {
    return new Gateway(this, 'Gateway', {
      naming: ctx.naming,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
      mcpToolsFunction: mcpTools.function,
      toolsJsonPath: ctx.paths.toolsJsonPath,
      auth: {
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        scope: auth.scope,
      },
    });
  }

  private buildRuntimes(ctx: BuildContext, gateway: Gateway, auth: Auth): Runtimes {
    return new Runtimes(this, 'Runtimes', {
      naming: ctx.naming,
      modelId: ctx.modelId,
      gatewayUrl: gateway.gatewayUrl,
      awsMcpSecret: gateway.awsMcpSecret,
      databricksSecret: auth.databricksSecret,
      docxAgentZipPath: ctx.paths.docxAgentZipPath,
      orchestratorZipPath: ctx.paths.orchestratorZipPath,
      jobTtlDays: '7',
    });
  }

  private buildAppLambdas(
    ctx: BuildContext,
    jobsTable: JobsTable,
    storage: Storage,
    runtimes: Runtimes,
  ): AppLambdas {
    return new AppLambdas(this, 'AppLambdas', {
      naming: ctx.naming,
      lambdasDir: ctx.paths.lambdasDir,
      jobsTable: jobsTable.table,
      uploadsBucket: storage.uploadsBucket,
      orchestratorRuntime: runtimes.orchestratorRuntime,
    });
  }
}
