import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/lib/errors.js';
import {
  buildUploadKey,
  createS3Helper,
  parseContentRangeTotal,
  parseUploadKey,
} from '../../src/lib/s3.js';

describe('buildUploadKey / parseUploadKey', () => {
  it('builds a sync upload key and round-trips it', () => {
    const jobId = '11111111-1111-4111-8111-111111111111';
    const key = buildUploadKey({ mode: 'sync', jobId, fileName: 'report.docx' });
    expect(key).toBe(`uploads/sync/${jobId}/report.docx`);
    expect(parseUploadKey(key)).toEqual({ mode: 'sync', jobId, fileName: 'report.docx' });
  });

  it('sanitizes unsafe characters and path separators out of the file name', () => {
    const jobId = '22222222-2222-4222-8222-222222222222';
    const key = buildUploadKey({
      mode: 'async',
      jobId,
      fileName: '../../etc/passwd; rm -rf *.pdf',
    });
    expect(key).not.toContain('..');
    expect(key).not.toContain('/etc');
    expect(key.startsWith(`uploads/async/${jobId}/`)).toBe(true);
  });

  it('throws ValidationError for a key outside the uploads/ prefix', () => {
    expect(() => parseUploadKey('results/job-1/result.json')).toThrow(ValidationError);
  });

  it('throws ValidationError for a key with a malformed jobId', () => {
    expect(() => parseUploadKey('uploads/sync/not-a-uuid/file.pdf')).toThrow(ValidationError);
  });
});

describe('createS3Helper', () => {
  const s3Mock = mockClient(S3Client);
  const client = new S3Client({
    region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  const helper = createS3Helper({ s3: client, bucket: 'docintel-uploads', ttlSeconds: 900 });

  beforeEach(() => {
    s3Mock.reset();
  });

  it('presignUpload returns an HTTPS PUT URL scoped to the bucket, key and default TTL', async () => {
    const url = await helper.presignUpload('uploads/sync/job-1/report.docx', 'application/pdf');
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toContain('docintel-uploads');
    expect(parsed.pathname).toContain('uploads/sync/job-1/report.docx');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('presignDownload uses the default TTL when none is given', async () => {
    const url = await helper.presignDownload('results/job-1/result.json');
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('presignDownload honors a per-call TTL override', async () => {
    const url = await helper.presignDownload('results/job-1/result.json', 60);
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('60');
  });

  it('getObjectBytes returns the object body as bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    s3Mock
      .on(GetObjectCommand)
      .resolves({ Body: { transformToByteArray: () => Promise.resolve(bytes) } as never });
    const result = await helper.getObjectBytes('uploads/sync/job-1/report.docx');
    expect(result).toBe(bytes);
  });

  it('getObjectBytes throws ValidationError when the response has no body', async () => {
    s3Mock.on(GetObjectCommand).resolves({});
    await expect(helper.getObjectBytes('uploads/sync/job-1/missing.docx')).rejects.toThrow(
      ValidationError,
    );
  });

  it('getObjectRange sends an inclusive byte Range and reads the total from Content-Range', async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToByteArray: () => Promise.resolve(bytes) } as never,
      ContentRange: 'bytes 10-12/1234',
    });
    const result = await helper.getObjectRange('uploads/sync/job-1/report.pdf', 10, 3);
    expect(s3Mock.commandCalls(GetObjectCommand)[0]?.args[0].input.Range).toBe('bytes=10-12');
    expect(result).toEqual({ bytes, totalBytes: 1234 });
  });

  it('parseContentRangeTotal handles present, malformed and missing headers', () => {
    expect(parseContentRangeTotal('bytes 0-99/5000')).toBe(5000);
    expect(parseContentRangeTotal('bytes */5000')).toBe(5000);
    expect(parseContentRangeTotal('garbage')).toBeUndefined();
    expect(parseContentRangeTotal(undefined)).toBeUndefined();
  });

  it('putJson serializes the object and writes it with an application/json content type', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    await helper.putJson('results/job-1/result.json', { summary: 'hi' });

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0].input).toMatchObject({
      Bucket: 'docintel-uploads',
      Key: 'results/job-1/result.json',
      Body: JSON.stringify({ summary: 'hi' }),
      ContentType: 'application/json',
    });
  });

  it('headObject returns the size when the object exists', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 4096 });
    const result = await helper.headObject('uploads/sync/job-1/report.docx');
    expect(result).toEqual({ sizeBytes: 4096 });
  });

  it('headObject returns undefined when the object does not exist (NotFound)', async () => {
    s3Mock.on(HeadObjectCommand).rejects(new NotFound({ message: 'Not Found', $metadata: {} }));
    const result = await helper.headObject('uploads/sync/job-1/missing.docx');
    expect(result).toBeUndefined();
  });

  it('headObject rethrows non-NotFound errors', async () => {
    s3Mock.on(HeadObjectCommand).rejects(new Error('access denied'));
    await expect(helper.headObject('uploads/sync/job-1/report.docx')).rejects.toThrow(
      'access denied',
    );
  });
});
