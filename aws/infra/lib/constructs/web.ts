import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as deployment from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface WebProps {
  readonly webBucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  /** Path to the built SPA (`frontend/dist`). */
  readonly frontendDistPath: string;
  /** The API's Lambda Function URL, written into `config.json` for the SPA to read. */
  readonly apiUrl: string;
}

/**
 * Deploys the built SPA (`frontend/dist`) to the web bucket and overwrites its `config.json`
 * with the deployed API URL (PLAN.md §3 item Web; TASKS T4.4; `frontend/src/lib/config.ts`
 * expects `/config.json` -> `{apiUrl}`), then invalidates CloudFront so the new build is live
 * immediately.
 */
export class Web extends Construct {
  readonly deployment: deployment.BucketDeployment;

  constructor(scope: Construct, id: string, props: WebProps) {
    super(scope, id);
    this.deployment = new deployment.BucketDeployment(this, 'Deployment', {
      sources: [
        deployment.Source.asset(props.frontendDistPath),
        deployment.Source.jsonData('config.json', { apiUrl: props.apiUrl }),
      ],
      destinationBucket: props.webBucket,
      distribution: props.distribution,
      distributionPaths: ['/*'],
    });
  }
}
