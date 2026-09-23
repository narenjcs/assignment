/**
 * Computes the CloudFormation stack id for a given stage (review round 1, item 2). The default
 * "dev" stage keeps the original unsuffixed id for backwards compatibility with any already-
 * deployed dev stack; every other stage gets its own id so `-c stage=prod` synthesizes/deploys a
 * separate stack instead of resolving to (and mutating or destroying) the dev stack's resources.
 */
export function resolveStackId(stage: string): string {
  return stage === 'dev' ? 'DocIntelStack' : `DocIntelStack-${stage}`;
}
