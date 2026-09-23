import { CfnOutput, type Stack } from 'aws-cdk-lib';
import type { Storage } from './constructs/storage.js';
import type { JobsTable } from './constructs/jobs-table.js';
import type { Auth } from './constructs/auth.js';
import type { Gateway } from './constructs/gateway.js';
import type { Runtimes } from './constructs/runtimes.js';
import type { Api } from './constructs/api.js';

export interface OutputResources {
  readonly storage: Storage;
  readonly jobsTable: JobsTable;
  readonly auth: Auth;
  readonly gateway: Gateway;
  readonly runtimes: Runtimes;
  readonly api: Api;
}

/** CloudFormation Outputs for every value operators or `make link` need after deploy. */
export function writeOutputs(stack: Stack, resources: OutputResources): void {
  const { storage, jobsTable, auth, gateway, runtimes, api } = resources;
  new CfnOutput(stack, 'WebUrl', {
    value: `https://${storage.distribution.distributionDomainName}`,
  });
  new CfnOutput(stack, 'ApiUrl', { value: api.functionUrl.url });
  new CfnOutput(stack, 'GatewayUrl', { value: gateway.gatewayUrl });
  new CfnOutput(stack, 'CognitoTokenUrl', { value: auth.tokenUrl });
  new CfnOutput(stack, 'CognitoClientId', { value: auth.clientId });
  new CfnOutput(stack, 'CognitoScope', { value: auth.scope });
  new CfnOutput(stack, 'UploadsBucket', { value: storage.uploadsBucket.bucketName });
  new CfnOutput(stack, 'JobsTableName', { value: jobsTable.table.tableName });
  new CfnOutput(stack, 'OrchestratorRuntimeArn', {
    value: runtimes.orchestratorRuntime.agentRuntimeArn,
  });
  new CfnOutput(stack, 'DocxRuntimeArn', { value: runtimes.docxRuntime.agentRuntimeArn });
  new CfnOutput(stack, 'DatabricksSecretArn', { value: auth.databricksSecret.secretArn });
  new CfnOutput(stack, 'AwsMcpSecretArn', { value: gateway.awsMcpSecret.secretArn });
}
