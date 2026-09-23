import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy, SecretValue, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { Naming } from './naming.js';

export interface AuthProps {
  readonly naming: Naming;
}

interface ClientCredentials {
  readonly client: cognito.UserPoolClient;
  readonly tokenUrl: string;
  readonly scope: string;
}

/**
 * Cognito M2M auth for the AgentCore Gateway (PLAN.md §2.3, §3 item Cognito; TASKS T2.4) and
 * the `docintel/databricks` secret placeholder (TASKS T2.5) — grouped here because both are
 * "credentials for cross-system auth" rather than application infrastructure.
 */
export class Auth extends Construct {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: SecretValue;
  readonly scope: string;
  readonly databricksSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);
    this.userPool = this.buildUserPool(props);
    const credentials = this.buildClient(props, this.userPool);
    this.userPoolClient = credentials.client;
    this.tokenUrl = credentials.tokenUrl;
    this.scope = credentials.scope;
    this.clientId = this.userPoolClient.userPoolClientId;
    this.clientSecret = this.userPoolClient.userPoolClientSecret;
    this.databricksSecret = this.buildDatabricksSecret(props);
  }

  private buildUserPool(props: AuthProps): cognito.UserPool {
    return new cognito.UserPool(this, 'UserPool', {
      userPoolName: props.naming.resource('users'),
      selfSignUpEnabled: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }

  private buildClient(props: AuthProps, userPool: cognito.UserPool): ClientCredentials {
    const region = Stack.of(this).region;
    const domain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: props.naming.cognitoDomainPrefix },
    });
    const invokeScope = new cognito.ResourceServerScope({
      scopeName: props.naming.gatewayScopeName,
      scopeDescription: 'Invoke DocIntel Gateway MCP tools',
    });
    const resourceServer = userPool.addResourceServer('GatewayResourceServer', {
      identifier: props.naming.gatewayResourceServerId,
      scopes: [invokeScope],
    });
    const client = userPool.addClient('GatewayClient', {
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [cognito.OAuthScope.resourceServer(resourceServer, invokeScope)],
      },
    });
    return {
      client,
      tokenUrl: `https://${domain.domainName}.auth.${region}.amazoncognito.com/oauth2/token`,
      scope: `${props.naming.gatewayResourceServerId}/${props.naming.gatewayScopeName}`,
    };
  }

  private buildDatabricksSecret(props: AuthProps): secretsmanager.Secret {
    // Placeholder JSON filled in later by `make link` (PLAN.md §5) — never real credentials here.
    return new secretsmanager.Secret(this, 'DatabricksSecret', {
      secretName: props.naming.databricksSecret,
      removalPolicy: RemovalPolicy.DESTROY,
      secretObjectValue: {
        host: SecretValue.unsafePlainText(''),
        clientId: SecretValue.unsafePlainText(''),
        clientSecret: SecretValue.unsafePlainText(''),
        mcpUrl: SecretValue.unsafePlainText(''),
        jobId: SecretValue.unsafePlainText(''),
      },
    });
  }
}
