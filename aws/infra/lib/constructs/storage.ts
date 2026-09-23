import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { Naming } from './naming.js';
import { JOB_TTL_DAYS } from '../constants.js';

export interface StorageProps {
  readonly naming: Naming;
}

const SPA_ERROR_CODES = [403, 404];

/**
 * Storage layer (PLAN.md §3 item 1): the uploads bucket the browser PUTs documents to, and the
 * web bucket + CloudFront distribution that serve the SPA. The S3 -> Lambda event notification
 * is wired by the stack after the s3-trigger Lambda exists (storage.ts has no Lambda reference).
 */
export class Storage extends Construct {
  readonly uploadsBucket: s3.Bucket;
  readonly webBucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);
    this.uploadsBucket = this.buildUploadsBucket(props);
    this.webBucket = this.buildWebBucket(props);
    this.distribution = this.buildDistribution();
  }

  private buildUploadsBucket(props: StorageProps): s3.Bucket {
    return new s3.Bucket(this, 'UploadsBucket', {
      bucketName: props.naming.uploadsBucket,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
      // Matches JOB_TTL_DAYS (lib/constants.ts) so the uploaded source object and its DynamoDB
      // job record expire together (review round 1, item 7 — single source for the 7-day value).
      lifecycleRules: [{ expiration: Duration.days(JOB_TTL_DAYS) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }

  private buildWebBucket(props: StorageProps): s3.Bucket {
    return new s3.Bucket(this, 'WebBucket', {
      bucketName: props.naming.webBucket,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }

  private buildDistribution(): cloudfront.Distribution {
    return new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: SPA_ERROR_CODES.map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
      })),
    });
  }
}
