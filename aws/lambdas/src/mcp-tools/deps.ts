import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Config } from '../lib/config.js';
import { createJobStore } from '../lib/jobs.js';
import { createS3Helper } from '../lib/s3.js';
import type { McpToolDeps } from './registry.js';

/**
 * Builds the mcp-tools Lambda's clients once per module (cold start, DEVELOPMENT.md §3).
 * This target never calls AgentCore itself (tools are leaves the orchestrator calls into),
 * so unlike the api handler it needs no BedrockAgentCoreClient.
 */
export function buildMcpToolDeps(config: Config): McpToolDeps {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.AWS_REGION }));
  const s3 = new S3Client({ region: config.AWS_REGION });
  return {
    jobStore: createJobStore({ ddb, tableName: config.JOBS_TABLE, ttlDays: config.JOB_TTL_DAYS }),
    s3Helper: createS3Helper({
      s3,
      bucket: config.UPLOADS_BUCKET,
      ttlSeconds: config.PRESIGN_TTL_SECONDS,
    }),
  };
}
