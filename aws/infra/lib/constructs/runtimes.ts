import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { Naming } from './naming.js';

/**
 * Cross-region ("system-defined") Bedrock inference-profile prefixes. This is the exhaustive set
 * AWS currently documents — it also doubles as the "supported prefix" allow-list for
 * `buildModelArns`'s validation below.
 */
const CROSS_REGION_PREFIXES = ['us.', 'eu.', 'apac.', 'global.'] as const;
type CrossRegionPrefix = (typeof CROSS_REGION_PREFIXES)[number];

/**
 * Regions each non-global cross-region prefix's constituent foundation models live in (a demo-
 * scoped approximation of AWS's published CRIS region groupings). Not used for `global.`, whose
 * profiles AWS documents as able to route to any commercial region — see `buildModelArns`.
 */
const INFERENCE_PROFILE_REGIONS: Record<Exclude<CrossRegionPrefix, 'global.'>, string[]> = {
  'us.': ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2'],
  'eu.': ['eu-central-1', 'eu-west-1', 'eu-west-3', 'eu-north-1'],
  'apac.': ['ap-northeast-1', 'ap-northeast-2', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2'],
};

export interface RuntimesProps {
  readonly naming: Naming;
  readonly modelId: string;
  readonly gatewayUrl: string;
  readonly awsMcpSecret: secretsmanager.ISecret;
  readonly databricksSecret: secretsmanager.ISecret;
  /** Path to `aws/agents/dist/docx_agent.zip`. */
  readonly docxAgentZipPath: string;
  /** Path to `aws/agents/dist/orchestrator.zip`. */
  readonly orchestratorZipPath: string;
  /** Job TTL in days, forwarded to both runtimes so they can stamp DynamoDB `ttl`. */
  readonly jobTtlDays: string;
}

/**
 * The two Bedrock AgentCore runtimes (PLAN.md §2.2, §3 items Runtimes; TASKS T2.8): a DOCX
 * text-extraction agent and an orchestrator that calls it plus the Gateway's MCP tools. Model
 * access is granted only for the specific `modelId` given via CDK context — never `bedrock:*`.
 *
 * Both runtimes need `GATEWAY_URL`/`AWS_MCP_SECRET_ARN`/read access to the aws-mcp secret: every
 * `docintel_common.mcp_backend` caller (both `aws/agents/docx_agent/main.py` and
 * `aws/agents/orchestrator`) reads those on every invocation, not just the orchestrator.
 */
export class Runtimes extends Construct {
  readonly docxRuntime: agentcore.Runtime;
  readonly orchestratorRuntime: agentcore.Runtime;

  constructor(scope: Construct, id: string, props: RuntimesProps) {
    super(scope, id);
    this.docxRuntime = this.buildDocxRuntime(props);
    this.orchestratorRuntime = this.buildOrchestratorRuntime(props);
    this.docxRuntime.grantInvoke(this.orchestratorRuntime);
    this.grantModelAccess(props, this.docxRuntime);
    this.grantModelAccess(props, this.orchestratorRuntime);
    props.databricksSecret.grantRead(this.orchestratorRuntime);
    props.awsMcpSecret.grantRead(this.orchestratorRuntime);
    props.awsMcpSecret.grantRead(this.docxRuntime);
  }

  private buildDocxRuntime(props: RuntimesProps): agentcore.Runtime {
    return new agentcore.Runtime(this, 'DocxRuntime', {
      runtimeName: props.naming.docxRuntimeName,
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromCodeAsset({
        path: props.docxAgentZipPath,
        runtime: agentcore.AgentCoreRuntime.PYTHON_3_12,
        entrypoint: ['main.py'],
      }),
      protocolConfiguration: agentcore.ProtocolType.HTTP,
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      environmentVariables: {
        BEDROCK_MODEL_ID: props.modelId,
        GATEWAY_URL: props.gatewayUrl,
        AWS_MCP_SECRET_ARN: props.awsMcpSecret.secretArn,
        JOB_TTL_DAYS: props.jobTtlDays,
      },
    });
  }

  private buildOrchestratorRuntime(props: RuntimesProps): agentcore.Runtime {
    return new agentcore.Runtime(this, 'OrchestratorRuntime', {
      runtimeName: props.naming.orchestratorRuntimeName,
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromCodeAsset({
        path: props.orchestratorZipPath,
        runtime: agentcore.AgentCoreRuntime.PYTHON_3_12,
        entrypoint: ['main.py'],
      }),
      protocolConfiguration: agentcore.ProtocolType.HTTP,
      networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      environmentVariables: {
        BEDROCK_MODEL_ID: props.modelId,
        GATEWAY_URL: props.gatewayUrl,
        AWS_MCP_SECRET_ARN: props.awsMcpSecret.secretArn,
        DATABRICKS_SECRET_ARN: props.databricksSecret.secretArn,
        DOCX_AGENT_ARN: this.docxRuntime.agentRuntimeArn,
        JOB_TTL_DAYS: props.jobTtlDays,
      },
    });
  }

  private grantModelAccess(props: RuntimesProps, runtime: agentcore.Runtime): void {
    const resources = buildModelArns(Stack.of(this).region, Stack.of(this).account, props.modelId);
    runtime.grant(['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'], resources);
  }
}

/**
 * Computes the exact Bedrock model/inference-profile ARNs a runtime needs to invoke `modelId`,
 * never a bare `*` resource. Cross-region model ids (`us.`/`eu.`/`apac.`/`global.` prefixed) also
 * need the underlying foundation-model ARNs granted, since Bedrock routes the inference-profile
 * invocation to one of its constituent regions and IAM must allow the model there too. `global.`
 * profiles are documented by AWS as able to route to any commercial region, so that grant uses a
 * wildcard region segment (not a bare `Resource: "*"` — the resource path is still pinned to one
 * specific foundation model) instead of an enumerated region list.
 *
 * Throws at synth time for a `modelId` that looks like an attempted cross-region profile id
 * (two or more dots — real Bedrock provider ids never contain a dot and model names use hyphens,
 * not dots, so a bare `<provider>.<model>` id always has exactly one) whose prefix isn't one of
 * the four AWS currently defines, instead of silently granting an ARN for the wrong resource.
 */
export function buildModelArns(region: string, account: string, modelId: string): string[] {
  if (!modelId || !modelId.trim()) {
    throw new Error('Bedrock modelId must be a non-empty string.');
  }

  const crossRegionPrefix = matchCrossRegionPrefix(modelId);
  if (!crossRegionPrefix) {
    return [foundationModelArn(region, modelId)];
  }

  const baseModelId = modelId.slice(crossRegionPrefix.length);
  const inferenceProfileArn = `arn:aws:bedrock:${region}:${account}:inference-profile/${modelId}`;

  if (crossRegionPrefix === 'global.') {
    return [inferenceProfileArn, `arn:aws:bedrock:*::foundation-model/${baseModelId}`];
  }

  const foundationModelArns = INFERENCE_PROFILE_REGIONS[crossRegionPrefix].map((inRegion) =>
    foundationModelArn(inRegion, baseModelId),
  );
  return [inferenceProfileArn, ...foundationModelArns];
}

function foundationModelArn(inRegion: string, id: string): string {
  return `arn:aws:bedrock:${inRegion}::foundation-model/${id}`;
}

function matchCrossRegionPrefix(modelId: string): CrossRegionPrefix | undefined {
  const recognized = CROSS_REGION_PREFIXES.find((prefix) => modelId.startsWith(prefix));
  if (recognized) {
    return recognized;
  }

  const dotCount = (modelId.match(/\./g) ?? []).length;
  if (dotCount >= 2) {
    const attemptedPrefix = modelId.slice(0, modelId.indexOf('.') + 1);
    throw new Error(
      `Unsupported Bedrock cross-region inference-profile prefix "${attemptedPrefix}" in ` +
        `modelId "${modelId}". Supported prefixes: ${CROSS_REGION_PREFIXES.join(', ')} ` +
        `(or a bare "<provider>.<model>" foundation-model id).`,
    );
  }
  return undefined;
}
