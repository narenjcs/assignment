import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AgentCoreInvoker } from '../lib/agentcore.js';
import { createAgentCoreInvoker } from '../lib/agentcore.js';
import type { Config } from '../lib/config.js';
import type { JobStore } from '../lib/jobs.js';
import { createJobStore } from '../lib/jobs.js';

export interface S3TriggerDeps {
  jobStore: JobStore;
  agentCore: AgentCoreInvoker;
}

/**
 * Builds the s3-trigger Lambda's clients once per module (cold start, DEVELOPMENT.md §3).
 * This handler never reads object bytes from S3 (the event carries key + size already), so
 * unlike the api handler it needs no S3Client — only DynamoDB and AgentCore invoke.
 */
export function buildS3TriggerDeps(config: Config): S3TriggerDeps {
  if (!config.ORCHESTRATOR_ARN) {
    throw new Error('ORCHESTRATOR_ARN is required for the s3-trigger handler');
  }
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.AWS_REGION }));
  const bedrock = new BedrockAgentCoreClient({ region: config.AWS_REGION });
  return {
    jobStore: createJobStore({ ddb, tableName: config.JOBS_TABLE, ttlDays: config.JOB_TTL_DAYS }),
    agentCore: createAgentCoreInvoker({ client: bedrock, runtimeArn: config.ORCHESTRATOR_ARN }),
  };
}
