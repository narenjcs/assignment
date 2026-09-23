import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy, SecretValue } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { Naming } from './naming.js';

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
  }

  private buildGateway(props: GatewayProps): agentcore.Gateway {
    return new agentcore.Gateway(this, 'Gateway', {
      gatewayName: props.naming.resource('gateway'),
      protocolConfiguration: agentcore.GatewayProtocol.mcp(),
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
