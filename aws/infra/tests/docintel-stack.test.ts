import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { DocIntelStack } from '../lib/docintel-stack.js';
import { createNaming } from '../lib/constructs/naming.js';

const TEST_ACCOUNT = '111111111111';
const TEST_REGION = 'us-east-1';
const TEST_MODEL_ID = 'openai.gpt-oss-120b-1:0';

// `Runtime`'s own `addExecutionRolePermissions` bakes these two Sids in with a bare `*`: X-Ray
// (no resource-level perms exist) and CloudWatch PutMetricData (scoped by a namespace condition
// instead). Nothing we author grants a bare `*`; this is the sole allow-list below.
const ALLOWED_WILDCARD_SIDS = new Set(['XRayAccess', 'CloudWatchMetrics']);

// The CDK `BucketDeployment` construct's own singleton Lambda role unconditionally adds this
// ungated, Sid-less statement for CloudFront invalidation with no prop to scope it down.
const ALLOWED_WILDCARD_ACTION_SETS = [
  ['cloudfront:GetInvalidation', 'cloudfront:CreateInvalidation'],
];

interface Statement {
  Sid?: string;
  Action?: unknown;
  Resource?: unknown;
}

function isAllowedWildcardStatement(statement: Statement): boolean {
  if (ALLOWED_WILDCARD_SIDS.has(statement.Sid ?? '')) {
    return true;
  }
  const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
  return ALLOWED_WILDCARD_ACTION_SETS.some(
    (allowed) => allowed.length === actions.length && allowed.every((a) => actions.includes(a)),
  );
}

// Recursively gathers every string leaf out of a (possibly CFN-intrinsic) template value, good
// enough to substring-search JSON text CDK has split across an `Fn::Join` around a token.
function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

let template: Template;
let naming: ReturnType<typeof createNaming>;

beforeAll(() => {
  const app = new App();
  const stack = new DocIntelStack(app, 'TestStack', {
    modelId: TEST_MODEL_ID,
    stage: 'dev',
    env: { account: TEST_ACCOUNT, region: TEST_REGION },
  });
  template = Template.fromStack(stack);
  naming = createNaming({ stage: 'dev', account: TEST_ACCOUNT });
});

describe('storage', () => {
  it('creates exactly the uploads and web buckets', () => {
    template.resourceCountIs('AWS::S3::Bucket', 2);
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: naming.uploadsBucket,
    });
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: naming.webBucket,
    });
  });

  it('creates one CloudFront distribution with SPA error responses', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        ]),
      }),
    });
  });

  it('expires uploads on the same TTL as job records (review round 1, item 7)', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: naming.uploadsBucket,
      LifecycleConfiguration: {
        Rules: Match.arrayWith([Match.objectLike({ ExpirationInDays: 7, Status: 'Enabled' })]),
      },
    });
  });
});

describe('jobs table', () => {
  it('creates one table with the byCreatedAt GSI and TTL', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: naming.jobsTable,
      KeySchema: [{ AttributeName: 'jobId', KeyType: 'HASH' }],
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'byCreatedAt',
          KeySchema: [
            { AttributeName: 'entity', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
        }),
      ]),
    });
  });
});

describe('auth', () => {
  it('creates one Cognito user pool, client, and resource server', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolResourceServer', 1);
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      AllowedOAuthFlows: ['client_credentials'],
    });
  });

  it('creates the databricks secret placeholder', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: naming.databricksSecret,
    });
  });
});

describe('gateway', () => {
  it('creates one gateway with a CUSTOM_JWT authorizer and one Lambda target', () => {
    template.resourceCountIs('AWS::BedrockAgentCore::Gateway', 1);
    template.resourceCountIs('AWS::BedrockAgentCore::GatewayTarget', 1);
    template.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
      AuthorizerType: 'CUSTOM_JWT',
    });
  });

  it('creates the aws-mcp secret', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: naming.awsMcpSecret,
    });
  });
});

describe('cognito client secret handling (review round 1, item 9)', () => {
  it('never materializes the aws-mcp secret SecretString as a literal plaintext string', () => {
    const secrets = template.findResources('AWS::SecretsManager::Secret', {
      Properties: { Name: naming.awsMcpSecret },
    });
    const matches = Object.values(secrets);
    expect(matches.length).toBe(1);
    const secretString = (matches[0] as { Properties: { SecretString?: unknown } }).Properties
      .SecretString;
    // A literal plaintext value would synthesize as a bare JS string; CDK's clientSecret token
    // always resolves to an intrinsic (Fn::Join/Fn::GetAtt) object instead.
    expect(typeof secretString).not.toBe('string');
  });

  it('suppresses CloudWatch response logging on the Cognito DescribeUserPoolClient lookup', () => {
    // CDK's `userPoolClientSecret` getter gives its own custom resource an explicit
    // `resourceType: "Custom::DescribeCognitoUserPoolClient"` override, so it does not show up
    // under the generic `Custom::AWS` type used elsewhere in this stack (e.g. the force-delete
    // custom resources in `force-delete-secret.ts`).
    const describeCalls = template.findResources('Custom::DescribeCognitoUserPoolClient');
    expect(Object.keys(describeCalls).length).toBeGreaterThan(0);
    for (const resource of Object.values(describeCalls)) {
      const text = collectStrings((resource as { Properties?: unknown }).Properties).join('');
      expect(text).toContain('describeUserPoolClient');
      expect(text).toContain('"logApiResponseData":false');
    }
  });
});

describe('secret force-delete on destroy (review round 1, item 5)', () => {
  it('force-deletes both the databricks and aws-mcp secrets instead of a 30-day recovery window', () => {
    const customResources = template.findResources('Custom::AWS');
    const forceDeletes = Object.values(customResources).filter((resource) => {
      const del = (resource as { Properties?: { Delete?: unknown } }).Properties?.Delete;
      const text = collectStrings(del).join('');
      return (
        text.includes('"action":"deleteSecret"') &&
        text.includes('"ForceDeleteWithoutRecovery":true')
      );
    });
    expect(forceDeletes.length).toBe(2);
  });
});

describe('runtimes', () => {
  it('creates exactly two AgentCore runtimes', () => {
    template.resourceCountIs('AWS::BedrockAgentCore::Runtime', 2);
  });

  it('sets BEDROCK_MODEL_ID from CDK context on both runtimes', () => {
    const runtimes = template.findResources('AWS::BedrockAgentCore::Runtime');
    const names = Object.values(runtimes).map(
      (resource) =>
        (resource as { Properties: { EnvironmentVariables?: Record<string, string> } }).Properties
          .EnvironmentVariables?.BEDROCK_MODEL_ID,
    );
    expect(names).toEqual([TEST_MODEL_ID, TEST_MODEL_ID]);
  });

  it('names the runtimes per PLAN.md', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      AgentRuntimeName: naming.docxRuntimeName,
    });
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      AgentRuntimeName: naming.orchestratorRuntimeName,
    });
  });

  it('gives both runtimes GATEWAY_URL and AWS_MCP_SECRET_ARN (review round 1, item 1)', () => {
    const runtimes = template.findResources('AWS::BedrockAgentCore::Runtime');
    const envVarsList = Object.values(runtimes).map(
      (resource) =>
        (resource as { Properties: { EnvironmentVariables?: Record<string, unknown> } }).Properties
          .EnvironmentVariables,
    );
    expect(envVarsList.length).toBe(2);
    for (const envVars of envVarsList) {
      expect(envVars).toBeDefined();
      expect(envVars?.GATEWAY_URL).toBeDefined();
      expect(envVars?.AWS_MCP_SECRET_ARN).toBeDefined();
    }
  });

  it('grants secretsmanager:GetSecretValue to both runtime execution roles (review round 1, item 1)', () => {
    const policies = Object.entries(template.findResources('AWS::IAM::Policy'));

    for (const roleSubstring of ['DocxRuntimeExecutionRole', 'OrchestratorRuntimeExecutionRole']) {
      const roleStatements = policies
        .filter(([logicalId]) => logicalId.includes(roleSubstring))
        .flatMap(
          ([, policy]) =>
            (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties
              .PolicyDocument.Statement,
        );

      const hasGetSecretValue = roleStatements.some((statement) => {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        return actions.includes('secretsmanager:GetSecretValue');
      });
      expect(hasGetSecretValue).toBe(true);
    }
  });
});

describe('lambdas', () => {
  it('creates the mcp-tools, api, and s3-trigger functions', () => {
    for (const name of [
      naming.resource('mcp-tools'),
      naming.resource('api'),
      naming.resource('s3-trigger'),
    ]) {
      template.hasResourceProperties('AWS::Lambda::Function', { FunctionName: name });
    }
  });

  it('gives every app Lambda the JOBS_TABLE and JOB_TTL_DAYS env vars', () => {
    for (const name of [
      naming.resource('mcp-tools'),
      naming.resource('api'),
      naming.resource('s3-trigger'),
    ]) {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: name,
        Environment: {
          Variables: Match.objectLike({ JOBS_TABLE: Match.anyValue(), JOB_TTL_DAYS: '7' }),
        },
      });
    }
  });

  it("caps the api Lambda's reserved concurrency (review round 1, item 6)", () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: naming.resource('api'),
      ReservedConcurrentExecutions: 20,
    });
  });
});

describe('api', () => {
  it('exposes a Function URL in RESPONSE_STREAM mode with no auth', () => {
    template.hasResourceProperties('AWS::Lambda::Url', {
      AuthType: 'NONE',
      InvokeMode: 'RESPONSE_STREAM',
    });
  });
});

/** Appends an offender label for every statement in `statements` that has an unjustified bare `"*"` Resource. */
function collectWildcardOffenders(
  logicalId: string,
  label: string,
  statements: Statement[],
  offenders: string[],
): void {
  for (const statement of statements) {
    const resourceField = Array.isArray(statement.Resource)
      ? statement.Resource
      : [statement.Resource];
    const hasBareWildcard = resourceField.some((r) => r === '*');
    if (hasBareWildcard && !isAllowedWildcardStatement(statement)) {
      offenders.push(`${logicalId}${label}/${statement.Sid ?? '(no sid)'}`);
    }
  }
}

describe('IAM least privilege', () => {
  it('never grants a bare Resource "*" outside the documented AgentCore exceptions', () => {
    const offenders: string[] = [];

    const scan = (
      resourceType: string,
      extractStatementSets: (properties: Record<string, unknown>) => Array<[string, Statement[]]>,
    ): void => {
      const resources = template.findResources(resourceType);
      for (const [logicalId, resource] of Object.entries(resources)) {
        const properties = (resource as { Properties: Record<string, unknown> }).Properties;
        for (const [label, statements] of extractStatementSets(properties)) {
          collectWildcardOffenders(logicalId, label, statements, offenders);
        }
      }
    };

    // Standalone inline policies attached via `Roles`/`Users`/`Groups`.
    scan('AWS::IAM::Policy', (properties) => [
      ['', (properties.PolicyDocument as { Statement: Statement[] }).Statement],
    ]);
    // Inline policies embedded directly on a Role (review round 1, item 8): the `Policies`
    // property, one policy document per entry.
    scan('AWS::IAM::Role', (properties) => {
      const inlinePolicies = (properties.Policies ?? []) as Array<{
        PolicyName: string;
        PolicyDocument: { Statement: Statement[] };
      }>;
      return inlinePolicies.map((p) => [`/Policies/${p.PolicyName}`, p.PolicyDocument.Statement]);
    });
    // Standalone managed policies (review round 1, item 8).
    scan('AWS::IAM::ManagedPolicy', (properties) => [
      ['', (properties.PolicyDocument as { Statement: Statement[] }).Statement],
    ]);

    expect(offenders).toEqual([]);
  });

  it('gateway declares a non-empty MCP protocol configuration (service rejects an empty one)', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
      ProtocolConfiguration: {
        Mcp: {
          Instructions: Match.anyValue(),
          SupportedVersions: Match.arrayWith(['2025-06-18']),
        },
      },
    });
  });

  it('serves the API through the same CloudFront distribution (single origin, no CORS)', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        CacheBehaviors: Match.arrayWith(
          ['/health', '/uploads', '/jobs', '/jobs/*', '/chat'].map((PathPattern) =>
            Match.objectLike({ PathPattern, ViewerProtocolPolicy: 'redirect-to-https' }),
          ),
        ),
      },
    });
  });
});
