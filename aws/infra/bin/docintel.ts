#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { DocIntelStack } from '../lib/docintel-stack.js';
import { resolveStackId } from '../lib/stack-id.js';

const REGION = 'us-east-1';

const app = new App();

const modelId = app.node.tryGetContext('modelId') as string | undefined;
if (!modelId) {
  throw new Error(
    'Missing required CDK context "modelId" (pass -c modelId=<id> or set it in cdk.json)',
  );
}
const stage = (app.node.tryGetContext('stage') as string | undefined) ?? 'dev';

// The stack id itself must carry the stage (review round 1, item 2): otherwise `-c stage=prod`
// would resolve to the exact same CloudFormation stack as the default "dev" deploy, and CDK
// would happily replace/destroy dev's jobs table, buckets, etc. to reconcile it with a prod
// synth instead of creating a separate stack.
const stackId = resolveStackId(stage);

new DocIntelStack(app, stackId, {
  modelId,
  stage,
  // Account comes from the CLI's resolved credentials (the `cdk` CLI sets CDK_DEFAULT_ACCOUNT
  // before invoking this app); region is pinned to us-east-1 per the task brief. Never hard-code
  // an account id here.
  // `account` is omitted entirely when unset so the stack stays environment-agnostic
  // (spreading avoids an explicit `undefined`, which CDK's Environment type rejects).
  env: {
    ...(process.env.CDK_DEFAULT_ACCOUNT ? { account: process.env.CDK_DEFAULT_ACCOUNT } : {}),
    region: REGION,
  },
});
