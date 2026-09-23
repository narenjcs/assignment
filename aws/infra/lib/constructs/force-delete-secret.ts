import * as cr from 'aws-cdk-lib/custom-resources';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

/**
 * Forces Secrets Manager to hard-delete `secret` when the stack is destroyed, instead of leaving
 * it in the default 30-day "scheduled for deletion" state (review round 1, item 5): without this,
 * `make destroy && make deploy` fails for 30 days with "already scheduled for deletion" on the
 * exact same secret name.
 *
 * `AWS::SecretsManager::Secret`'s CloudFormation resource type has no property for the recovery
 * window at all — verified by grepping the entire `aws-cdk-lib` package for
 * `RecoveryWindowInDays`/`ForceDeleteWithoutRecovery`, neither appears anywhere in `CfnSecret`.
 * That parameter only exists on the `DeleteSecret` API call, never as a deployable CFN property,
 * so there is no "CfnSecret escape hatch" to reach for here. The only way to get this behavior
 * from CDK is this `AwsCustomResource`, whose sole `onDelete` SDK call issues
 * `secretsmanager:DeleteSecret` with `ForceDeleteWithoutRecovery: true` — it has no `onCreate`/
 * `onUpdate`, so it makes no API call except when the stack (or this resource) is destroyed, and
 * its IAM policy is scoped to this one secret's ARN (`AwsCustomResourcePolicy.fromSdkCalls`),
 * never a bare `*` resource.
 *
 * Ordering: because the custom resource's `Delete` call references `secret.secretArn`, CDK gives
 * it an implicit dependency on the secret, so CloudFormation deletes this custom resource first
 * (dependents are deleted before what they depend on) — while the secret still exists — then
 * proceeds to "delete" the now-already-gone `AWS::SecretsManager::Secret` resource itself, which
 * Secrets Manager/CloudFormation treats as a successful (idempotent) delete.
 */
export function forceDeleteOnDestroy(
  scope: Construct,
  id: string,
  secret: secretsmanager.ISecret,
): void {
  new cr.AwsCustomResource(scope, id, {
    onDelete: {
      service: 'SecretsManager',
      action: 'deleteSecret',
      parameters: {
        SecretId: secret.secretArn,
        ForceDeleteWithoutRecovery: true,
      },
      physicalResourceId: cr.PhysicalResourceId.of(secret.secretArn),
    },
    policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [secret.secretArn] }),
    // `deleteSecret` has been in every SDK version CDK bundles for the Lambda runtime; pin to
    // that bundled SDK instead of defaulting to "install latest at deploy time" (silences a
    // synth-time warning and avoids an untested SDK version being pulled in on every deploy).
    installLatestAwsSdk: false,
  });
}
