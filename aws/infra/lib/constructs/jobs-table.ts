import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { Naming } from './naming.js';

export interface JobsTableProps {
  readonly naming: Naming;
}

/**
 * DynamoDB `docintel-jobs` table (PLAN.md §2.4, TASKS T2.3): PK `jobId`, GSI `byCreatedAt` for
 * the newest-first job list, TTL cleanup, on-demand billing (demo workload, no capacity planning).
 */
export class JobsTable extends Construct {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: JobsTableProps) {
    super(scope, id);
    this.table = new dynamodb.Table(this, 'Table', {
      tableName: props.naming.jobsTable,
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: 'byCreatedAt',
      partitionKey: { name: 'entity', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
