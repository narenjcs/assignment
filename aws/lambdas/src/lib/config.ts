import { z } from 'zod';

// Env var names — keep in sync with .env.example and the CDK Lambda environment blocks.
// DEVELOPMENT.md §12 security checklist: presigned URLs must be <= 15 min (900s).
const MAX_PRESIGN_TTL_SECONDS = 900;
const DEFAULT_PRESIGN_TTL_SECONDS = 900;
const DEFAULT_JOB_TTL_DAYS = 7;

const envSchema = z.object({
  AWS_REGION: z.string().min(1, 'AWS_REGION is required'),
  JOBS_TABLE: z.string().min(1, 'JOBS_TABLE is required'),
  UPLOADS_BUCKET: z.string().min(1, 'UPLOADS_BUCKET is required'),
  ORCHESTRATOR_ARN: z.string().min(1).optional(),
  PRESIGN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PRESIGN_TTL_SECONDS)
    .default(DEFAULT_PRESIGN_TTL_SECONDS),
  JOB_TTL_DAYS: z.coerce.number().int().positive().default(DEFAULT_JOB_TTL_DAYS),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env` once per handler module (call at module top level,
 * not inside the handler body, so a bad deploy fails fast on cold start).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration: ${issues.join('; ')}`);
  }
  return parsed.data;
}
