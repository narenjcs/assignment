import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import type { AgentCoreInvoker } from '../lib/agentcore.js';
import { createAgentCoreInvoker } from '../lib/agentcore.js';
import type { Config } from '../lib/config.js';
import type { JobStore } from '../lib/jobs.js';
import { createJobStore } from '../lib/jobs.js';
import type { S3Helper } from '../lib/s3.js';
import { createS3Helper } from '../lib/s3.js';

export interface ApiDeps {
  config: Config;
  jobStore: JobStore;
  s3Helper: S3Helper;
  agentCore: AgentCoreInvoker;
}

/**
 * Builds the AWS SDK clients and adapters once per Lambda module (cold start), per
 * DEVELOPMENT.md §3 "clients are created once per module at top level and passed into
 * functions that need them". The api and s3-trigger handlers both need the orchestrator
 * ARN even though it is optional in the shared config schema (mcp-tools does not need it).
 */
export function buildApiDeps(config: Config): ApiDeps {
  if (!config.ORCHESTRATOR_ARN) {
    throw new Error('ORCHESTRATOR_ARN is required for the api handler');
  }
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.AWS_REGION }));
  const s3 = new S3Client({ region: config.AWS_REGION });
  const bedrock = new BedrockAgentCoreClient({ region: config.AWS_REGION });
  return {
    config,
    jobStore: createJobStore({ ddb, tableName: config.JOBS_TABLE, ttlDays: config.JOB_TTL_DAYS }),
    s3Helper: createS3Helper({
      s3,
      bucket: config.UPLOADS_BUCKET,
      ttlSeconds: config.PRESIGN_TTL_SECONDS,
    }),
    agentCore: createAgentCoreInvoker({ client: bedrock, runtimeArn: config.ORCHESTRATOR_ARN }),
  };
}
