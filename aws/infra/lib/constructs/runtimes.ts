import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { Naming } from './naming.js';

/** Regions the demo replicates cross-region inference-profile foundation-model ARNs into. */
const INFERENCE_PROFILE_REGIONS = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2'];
const CROSS_REGION_PREFIXES = ['us.', 'global.'];

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
  /** Job TTL in days, forwarded to the orchestrator so it can stamp DynamoDB `ttl`. */
  readonly jobTtlDays: string;
}

/**
 * The two Bedrock AgentCore runtimes (PLAN.md §2.2, §3 items Runtimes; TASKS T2.8): a DOCX
 * text-extraction agent and an orchestrator that calls it plus the Gateway's MCP tools. Model
 * access is granted only for the specific `modelId` given via CDK context — never `bedrock:*`.
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
 * never a bare `*` resource. Cross-region model ids (`us.`/`global.` prefixed) also need the
 * underlying foundation-model ARNs replicated across the profile's constituent regions.
 */
export function buildModelArns(region: string, account: string, modelId: string): string[] {
  const foundationModelArn = (inRegion: string, id: string): string =>
    `arn:aws:bedrock:${inRegion}::foundation-model/${id}`;

  const crossRegionPrefix = CROSS_REGION_PREFIXES.find((prefix) => modelId.startsWith(prefix));
  if (!crossRegionPrefix) {
    return [foundationModelArn(region, modelId)];
  }

  const baseModelId = modelId.slice(crossRegionPrefix.length);
  const inferenceProfileArn = `arn:aws:bedrock:${region}:${account}:inference-profile/${modelId}`;
  const foundationModelArns = INFERENCE_PROFILE_REGIONS.map((inRegion) =>
    foundationModelArn(inRegion, baseModelId),
  );
  return [inferenceProfileArn, ...foundationModelArns];
}
