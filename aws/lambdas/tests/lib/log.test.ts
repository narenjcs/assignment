import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/lib/log.js';

describe('createLogger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('emits one JSON line per call with the bound service name', () => {
    const logger = createLogger('api');
    logger.info('job_created', 'Job created', { jobId: 'job-1' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line.level).toBe('info');
    expect(line.service).toBe('api');
    expect(line.event).toBe('job_created');
    expect(line.msg).toBe('Job created');
    expect(line.jobId).toBe('job-1');
    expect(typeof line.ts).toBe('string');
  });

  it('defaults fields to an empty object when omitted', () => {
    const logger = createLogger('mcp-tools');
    logger.error('tool_failed', 'Tool failed');
    const line = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line.level).toBe('error');
    expect(line.service).toBe('mcp-tools');
  });

  it.each(['debug', 'info', 'warn', 'error'] as const)('supports level %s', (level) => {
    const logger = createLogger('s3-trigger');
    logger[level]('evt', 'msg');
    const line = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(line.level).toBe(level);
  });
});
