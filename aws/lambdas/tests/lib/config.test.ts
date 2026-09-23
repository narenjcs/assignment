import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/lib/config.js';

const BASE_ENV = {
  AWS_REGION: 'us-east-1',
  JOBS_TABLE: 'docintel-jobs',
  UPLOADS_BUCKET: 'docintel-uploads',
};

describe('loadConfig', () => {
  it('parses a minimal valid environment and applies defaults', () => {
    const config = loadConfig(BASE_ENV);
    expect(config.AWS_REGION).toBe('us-east-1');
    expect(config.JOBS_TABLE).toBe('docintel-jobs');
    expect(config.UPLOADS_BUCKET).toBe('docintel-uploads');
    expect(config.ORCHESTRATOR_ARN).toBeUndefined();
    expect(config.PRESIGN_TTL_SECONDS).toBe(900);
    expect(config.JOB_TTL_DAYS).toBe(7);
  });

  it('coerces numeric env vars from strings', () => {
    const config = loadConfig({ ...BASE_ENV, PRESIGN_TTL_SECONDS: '120', JOB_TTL_DAYS: '3' });
    expect(config.PRESIGN_TTL_SECONDS).toBe(120);
    expect(config.JOB_TTL_DAYS).toBe(3);
  });

  it('accepts an optional ORCHESTRATOR_ARN', () => {
    const config = loadConfig({
      ...BASE_ENV,
      ORCHESTRATOR_ARN: 'arn:aws:bedrock-agentcore:us-east-1:1:runtime/x',
    });
    expect(config.ORCHESTRATOR_ARN).toBe('arn:aws:bedrock-agentcore:us-east-1:1:runtime/x');
  });

  it('throws with a readable message when a required var is missing', () => {
    const rest = { JOBS_TABLE: BASE_ENV.JOBS_TABLE, UPLOADS_BUCKET: BASE_ENV.UPLOADS_BUCKET };
    expect(() => loadConfig(rest)).toThrow(/AWS_REGION/);
  });

  it('throws when PRESIGN_TTL_SECONDS exceeds the max', () => {
    expect(() => loadConfig({ ...BASE_ENV, PRESIGN_TTL_SECONDS: '999999' })).toThrow(
      /Invalid environment/,
    );
  });

  it('throws when a numeric field is not coercible', () => {
    expect(() => loadConfig({ ...BASE_ENV, JOB_TTL_DAYS: 'not-a-number' })).toThrow(
      /Invalid environment/,
    );
  });
});
