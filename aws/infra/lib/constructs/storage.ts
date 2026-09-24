import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { Naming } from './naming.js';
import { JOB_TTL_DAYS } from '../constants.js';

export interface StorageProps {
  readonly naming: Naming;
}

const API_PATH_PATTERNS = ['/health', '/uploads', '/jobs', '/jobs/*', '/chat'] as const;
/** API routes served from the Lambda Function URL origin (PLAN.md §2.6). */
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

  /**
   * Route the API's Lambda Function URL through this same CloudFront distribution.
   *
   * Without this the SPA has to call the `*.lambda-url.*.on.aws` host directly, which (a) is a
   * second origin, so every call is cross-origin, and (b) is refused outright by some upstream
   * DNS resolvers - verified on the demo network, where the router returns REFUSED for that
   * hostname while resolving every other AWS domain. Serving the API under the CloudFront domain
   * makes the whole app single-origin, so CORS disappears and only one hostname must resolve.
   *
   * Caching is disabled and all methods are allowed because these are dynamic, per-request
   * endpoints, and `ALL_VIEWER_EXCEPT_HOST_HEADER` is required: a Function URL origin rejects a
   * forwarded viewer `Host` header.
   */
  addApiBehaviors(functionUrl: lambda.FunctionUrl): void {
    const origin = new origins.FunctionUrlOrigin(functionUrl, {
      // SSE streams stay open for minutes while an agent works; don't cut them off early.
      readTimeout: Duration.seconds(60),
      keepaliveTimeout: Duration.seconds(60),
    });
    for (const pathPattern of API_PATH_PATTERNS) {
      this.distribution.addBehavior(pathPattern, origin, {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      });
    }
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
