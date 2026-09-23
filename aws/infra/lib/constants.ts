/**
 * Values shared by more than one construct that must never be allowed to drift apart (review
 * round 1, item 7). `JOB_TTL_DAYS` feeds both the DynamoDB item TTL that the Lambdas/runtimes
 * stamp (`JOB_TTL_DAYS` env var) and the uploads-bucket S3 lifecycle expiration, so a completed
 * job's source upload never outlives (or is deleted well before) the job record itself.
 */
export const JOB_TTL_DAYS = 7;

/** String form for Lambda/Runtime environment variables, which are always `Record<string, string>`. */
export const JOB_TTL_DAYS_STRING = String(JOB_TTL_DAYS);
