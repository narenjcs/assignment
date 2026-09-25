import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy, SecretValue } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { Naming } from './naming.js';
import { forceDeleteOnDestroy } from './force-delete-secret.js';

export interface GatewayAuthInputs {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: SecretValue;
  readonly scope: string;
}

export interface GatewayProps {
  readonly naming: Naming;
  readonly userPool: cognito.IUserPool;
  readonly userPoolClient: cognito.IUserPoolClient;
  readonly mcpToolsFunction: lambda.IFunction;
  readonly toolsJsonPath: string;
  readonly auth: GatewayAuthInputs;
}

/**
 * AgentCore Gateway (PLAN.md §3 item Gateway; TASKS T3.2): MCP protocol, Cognito JWT inbound
 * auth pinned to the one allowed client, one Lambda target ("jobs") exposing the tools from
 * `aws/lambdas/tools.json`. Exposed tool names become `jobs___<tool>` (Gateway target-name
 * prefix + `___` + schema tool name — see `mcp-tools/handler.ts` `resolveToolName`).
 *
 * Also owns the `docintel/aws-mcp` secret (PLAN.md §3 item Secrets): it can only be built here
 * because it needs this gateway's own `gatewayUrl`, which does not exist before this construct
 * runs.
 */
export class Gateway extends Construct {
  readonly gateway: agentcore.Gateway;
  readonly gatewayUrl: string;
  readonly awsMcpSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: GatewayProps) {
    super(scope, id);
    this.gateway = this.buildGateway(props);
    this.gatewayUrl = this.gateway.gatewayUrl ?? '';
    this.addJobsTarget(props);
    this.awsMcpSecret = this.buildAwsMcpSecret(props);
    forceDeleteOnDestroy(this, 'AwsMcpSecretForceDelete', this.awsMcpSecret);
  }

  private buildGateway(props: GatewayProps): agentcore.Gateway {
    return new agentcore.Gateway(this, 'Gateway', {
      gatewayName: props.naming.resource('gateway'),
      // The service rejects an empty MCP configuration with "MCP configuration cannot be empty"
      // (deploy-time 400, not caught by synth), so at least one of instructions / searchType /
      // supportedVersions must be set. The instructions are model-facing: they tell an agent
      // connecting to this gateway what the tool surface is for.
      protocolConfiguration: agentcore.GatewayProtocol.mcp({
        instructions:
          'DocIntel job tools. Use these to read and update document-processing jobs: get_job ' +
          'and list_jobs to read state, update_job_status and append_job_event to report ' +
          'progress, save_job_result to persist the final structured result, extract_docx_text ' +
          'to pull text out of a DOCX in S3, get_download_url to hand a document to another ' +
          'cloud, and get_document_content to fetch its bytes inline when the caller cannot ' +
          'reach S3. Always report progress before and after long steps.',
        supportedVersions: [agentcore.MCPProtocolVersion.MCP_2025_06_18],
      }),
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingCognito({
        userPool: props.userPool,
        allowedClients: [props.userPoolClient],
      }),
    });
  }

  private addJobsTarget(props: GatewayProps): void {
    this.gateway.addLambdaTarget('JobsTarget', {
      gatewayTargetName: 'jobs',
      lambdaFunction: props.mcpToolsFunction,
      toolSchema: agentcore.ToolSchema.fromLocalAsset(props.toolsJsonPath),
    });
  }

  private buildAwsMcpSecret(props: GatewayProps): secretsmanager.Secret {
    // Follow-up (T2.4, review round 1 item 9): `clientSecret` here is `Auth.clientSecret`, itself
    // sourced from CDK's own `userPoolClientSecret` custom resource — already verified safe
    // as-is (see the comment in auth.ts next to that getter: no plaintext in the template or
    // CloudWatch). The architecturally tighter alternative — have `docintel_common.mcp_backend`
    // fetch the client secret at runtime via `cognito-idp:DescribeUserPoolClient` instead of
    // reading it from this secret's `clientSecret` field — would remove the value from Secrets
    // Manager storage entirely, but requires changing the documented `AWS_MCP_SECRET_ARN` secret
    // shape and its one consumer (`aws/agents/orchestrator/tools.py` `gateway_client()`), both
    // outside `aws/infra`'s scope. Left as-is; flagged in the review-round-1 report.
    return new secretsmanager.Secret(this, 'AwsMcpSecret', {
      secretName: props.naming.awsMcpSecret,
      removalPolicy: RemovalPolicy.DESTROY,
      secretObjectValue: {
        tokenUrl: SecretValue.unsafePlainText(props.auth.tokenUrl),
        clientId: SecretValue.unsafePlainText(props.auth.clientId),
        clientSecret: props.auth.clientSecret,
        scope: SecretValue.unsafePlainText(props.auth.scope),
        gatewayUrl: SecretValue.unsafePlainText(this.gatewayUrl),
      },
    });
  }
}
