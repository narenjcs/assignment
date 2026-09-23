import { describe, expect, it } from 'vitest';
import { routeHealth } from '../../../src/api/routes/health.js';
import { buildTestContext, writtenText } from './helpers.js';

describe('routeHealth', () => {
  it('writes an ok:true liveness payload with a timestamp', async () => {
    const ctx = buildTestContext({ method: 'GET', path: '/health' });
    await routeHealth(ctx);

    const body = JSON.parse(writtenText(ctx)) as { ok: boolean; service: string; ts: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('api');
    expect(new Date(body.ts).toString()).not.toBe('Invalid Date');
  });
});
