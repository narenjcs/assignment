import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { DocIntelStack } from '../lib/docintel-stack.js';
import { createNaming } from '../lib/constructs/naming.js';

const TEST_ACCOUNT = '111111111111';
const TEST_REGION = 'us-east-1';
const TEST_MODEL_ID = 'openai.gpt-oss-120b-1:0';

/**
 * Execution-role wildcard `Resource: "*"` statements that the `Runtime` L2 construct bakes in
 * itself (`node_modules/aws-cdk-lib/aws-bedrockagentcore/lib/runtime/runtime.js`
 * `addExecutionRolePermissions`) and that AWS documents as requiring a `*` resource:
 * X-Ray (no resource-level permissions exist for these actions) and CloudWatch PutMetricData
 * (scoped instead by a `cloudwatch:namespace` condition). Nothing authored in this workspace
 * grants a bare `*`; this is the sole allow-list for the "no wildcard resources" assertion below.
 */
const ALLOWED_WILDCARD_SIDS = new Set(['XRayAccess', 'CloudWatchMetrics']);

/**
 * The CDK-provided `BucketDeployment` construct's own singleton Lambda role (used by our `Web`
 * construct to invalidate CloudFront after each deploy) unconditionally adds this ungated,
 * Sid-less statement itself whenever a `distribution` is passed
 * (`node_modules/aws-cdk-lib/aws-s3-deployment/lib/bucket-deployment.js`: `props.distribution &&
 * handler.addToRolePolicy(new iam.PolicyStatement({actions: ["cloudfront:GetInvalidation",
 * "cloudfront:CreateInvalidation"], resources: ["*"]}))`) — there is no prop to scope it to our
 * one distribution, so it cannot be tightened from this workspace.
 */
const ALLOWED_WILDCARD_ACTION_SETS = [
  ['cloudfront:GetInvalidation', 'cloudfront:CreateInvalidation'],
];

function isAllowedWildcardStatement(statement: { Sid?: string; Action?: unknown }): boolean {
  if (ALLOWED_WILDCARD_SIDS.has(statement.Sid ?? '')) {
    return true;
  }
  const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
  return ALLOWED_WILDCARD_ACTION_SETS.some(
    (allowed) => allowed.length === actions.length && allowed.every((a) => actions.includes(a)),
  );
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

  it('gives every app Lambda the JOBS_TABLE env var', () => {
    for (const name of [
      naming.resource('mcp-tools'),
      naming.resource('api'),
      naming.resource('s3-trigger'),
    ]) {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: name,
        Environment: { Variables: Match.objectLike({ JOBS_TABLE: Match.anyValue() }) },
      });
    }
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

describe('IAM least privilege', () => {
  it('never grants a bare Resource "*" outside the documented AgentCore exceptions', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const offenders: string[] = [];

    for (const [logicalId, policy] of Object.entries(policies)) {
      const statements = (
        policy as {
          Properties: {
            PolicyDocument: {
              Statement: Array<{ Sid?: string; Action?: unknown; Resource?: unknown }>;
            };
          };
        }
      ).Properties.PolicyDocument.Statement;

      for (const statement of statements) {
        const resources = Array.isArray(statement.Resource)
          ? statement.Resource
          : [statement.Resource];
        const hasBareWildcard = resources.some((resource) => resource === '*');
        if (hasBareWildcard && !isAllowedWildcardStatement(statement)) {
          offenders.push(`${logicalId}/${statement.Sid ?? '(no sid)'}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
