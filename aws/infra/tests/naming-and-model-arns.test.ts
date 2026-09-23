import { describe, expect, it } from 'vitest';
import { createNaming } from '../lib/constructs/naming.js';
import { buildModelArns } from '../lib/constructs/runtimes.js';
import { resolveStackId } from '../lib/stack-id.js';

// Pure-function unit tests split out of docintel-stack.test.ts (review round 1, items 2, 3, 4):
// none of these need a synthesized CFN template, so they run against `naming`/`runtimes`/
// `stack-id` directly instead of sharing that file's `beforeAll` stack fixture.

const TEST_ACCOUNT = '111111111111';
const TEST_REGION = 'us-east-1';
const TEST_MODEL_ID = 'openai.gpt-oss-120b-1:0';

describe('naming and stack-id stage-awareness (review round 1, items 2 and 3)', () => {
  it('stage-suffixes every globally-unique / cross-stage-sensitive name for a non-dev stage', () => {
    const dev = createNaming({ stage: 'dev', account: TEST_ACCOUNT });
    const prod = createNaming({ stage: 'prod', account: TEST_ACCOUNT });
    const keys = [
      'uploadsBucket',
      'webBucket',
      'databricksSecret',
      'awsMcpSecret',
      'cognitoDomainPrefix',
      'docxRuntimeName',
      'orchestratorRuntimeName',
    ] as const;
    for (const key of keys) {
      expect(prod[key]).not.toEqual(dev[key]);
    }
  });

  it('keeps runtime names within the AgentCore charset and 48-char limit for any stage', () => {
    const weird = createNaming({ stage: 'a very-invalid.stage!!', account: TEST_ACCOUNT });
    for (const name of [weird.docxRuntimeName, weird.orchestratorRuntimeName]) {
      expect(name.length).toBeLessThanOrEqual(48);
      expect(name).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
    }
  });

  it('keeps the unsuffixed stack id for "dev" and suffixes every other stage', () => {
    expect(resolveStackId('dev')).toBe('DocIntelStack');
    expect(resolveStackId('prod')).toBe('DocIntelStack-prod');
    expect(resolveStackId('prod')).not.toBe(resolveStackId('dev'));
  });
});

describe('buildModelArns (review round 1, item 4)', () => {
  it('grants only the foundation-model ARN for a bare modelId', () => {
    const arns = buildModelArns(TEST_REGION, TEST_ACCOUNT, TEST_MODEL_ID);
    expect(arns).toEqual([`arn:aws:bedrock:${TEST_REGION}::foundation-model/${TEST_MODEL_ID}`]);
  });

  it('derives the inference-profile ARN in the deploy region plus replica foundation-model ARNs for us./eu./apac.', () => {
    for (const [prefix, region] of [
      ['us.', 'us-east-1'],
      ['eu.', 'eu-west-1'],
      ['apac.', 'ap-southeast-1'],
    ] as const) {
      const modelId = `${prefix}anthropic.claude-3-haiku-20240307-v1:0`;
      const arns = buildModelArns(region, TEST_ACCOUNT, modelId);
      expect(arns[0]).toBe(
        `arn:aws:bedrock:${region}:${TEST_ACCOUNT}:inference-profile/${modelId}`,
      );
      expect(arns.length).toBeGreaterThan(1);
      expect(arns.slice(1).every((arn) => arn.startsWith('arn:aws:bedrock:'))).toBe(true);
    }
  });

  it('grants a wildcard-region foundation-model ARN for global. profiles', () => {
    const arns = buildModelArns(
      TEST_REGION,
      TEST_ACCOUNT,
      'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
    );
    expect(arns).toContain(
      'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0',
    );
  });

  it('throws a clear error for an unsupported cross-region prefix', () => {
    expect(() =>
      buildModelArns(TEST_REGION, TEST_ACCOUNT, 'emea.anthropic.claude-3-sonnet-20240229-v1:0'),
    ).toThrow(/Unsupported Bedrock cross-region inference-profile prefix "emea\."/);
  });

  it('throws a clear error for an empty modelId', () => {
    expect(() => buildModelArns(TEST_REGION, TEST_ACCOUNT, '')).toThrow(/non-empty/);
  });
});
