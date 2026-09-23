import { afterEach, describe, expect, it, vi } from 'vitest';

import { getConfig, resetConfigCache } from '../config';

function stubFetch(impl: () => Promise<Response>): void {
  global.fetch = impl;
}

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('getConfig', () => {
  afterEach(() => {
    resetConfigCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses /config.json when it responds with a valid config', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(true, { apiUrl: 'https://runtime.example.com' })));

    await expect(getConfig()).resolves.toEqual({ apiUrl: 'https://runtime.example.com' });
  });

  it('memoizes the config so /config.json is only fetched once', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse(true, { apiUrl: 'https://runtime.example.com' })),
    );
    global.fetch = fetchMock;

    await getConfig();
    await getConfig();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to VITE_API_URL when /config.json rejects', async () => {
    stubFetch(() => Promise.reject(new Error('network down')));
    vi.stubEnv('VITE_API_URL', 'http://localhost:9999');

    await expect(getConfig()).resolves.toEqual({ apiUrl: 'http://localhost:9999' });
  });

  it('falls back to VITE_API_URL when /config.json returns a non-ok response', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(false, {})));
    vi.stubEnv('VITE_API_URL', 'http://localhost:9999');

    await expect(getConfig()).resolves.toEqual({ apiUrl: 'http://localhost:9999' });
  });

  it('falls back to VITE_API_URL when /config.json body fails schema validation', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(true, { apiUrl: 42 })));
    vi.stubEnv('VITE_API_URL', 'http://localhost:9999');

    await expect(getConfig()).resolves.toEqual({ apiUrl: 'http://localhost:9999' });
  });

  it('throws when neither /config.json nor VITE_API_URL is available', async () => {
    stubFetch(() => Promise.reject(new Error('network down')));
    vi.stubEnv('VITE_API_URL', '');

    await expect(getConfig()).rejects.toThrow(/no API URL configured/);
  });
});
