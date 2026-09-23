import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
  getConfig: (): Promise<{ apiUrl: string }> => Promise.resolve({ apiUrl: 'http://api.test' }),
}));

import { chat, createUpload, getJob, listJobs, processJob, uploadFile } from '../api';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeSseReader(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    read: (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      if (index >= chunks.length) return Promise.resolve({ done: true, value: undefined });
      const value = encoder.encode(chunks[index]);
      index += 1;
      return Promise.resolve({ done: false, value });
    },
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

function sseResponse(chunks: string[]): Response {
  return {
    ok: true,
    status: 200,
    body: { getReader: () => makeSseReader(chunks) },
  } as unknown as Response;
}

function stubFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(impl);
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function noop(): void {
  // intentionally empty: some tests only care about the resolved/rejected promise
}

describe('createUpload', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to /uploads and returns the parsed response', async () => {
    const body = { jobId: 'j1', uploadUrl: 'https://s3.example/put', s3Key: 'uploads/j1' };
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(200, body)));

    await expect(
      createUpload({ fileName: 'a.pdf', contentType: 'application/pdf', mode: 'sync' }),
    ).resolves.toEqual(body);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/uploads');
    expect(init.method).toBe('POST');
  });

  it('maps an error envelope on a non-ok response to ApiError', async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse(400, { error: { code: 'BAD_INPUT', message: 'nope' } })),
    );

    await expect(
      createUpload({ fileName: 'a.pdf', contentType: 'application/pdf', mode: 'sync' }),
    ).rejects.toMatchObject({ code: 'BAD_INPUT', message: 'nope' });
  });

  it('maps a response that fails schema validation to INVALID_RESPONSE', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, { jobId: 'only-this-field' })));

    await expect(
      createUpload({ fileName: 'a.pdf', contentType: 'application/pdf', mode: 'sync' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('maps a network failure to ApiError NETWORK', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));

    await expect(
      createUpload({ fileName: 'a.pdf', contentType: 'application/pdf', mode: 'sync' }),
    ).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('maps an aborted request to ApiError TIMEOUT', async () => {
    vi.useFakeTimers();
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    const promise = createUpload({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      mode: 'sync',
    });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    vi.useRealTimers();
  });
});

describe('uploadFile', () => {
  afterEach(() => vi.restoreAllMocks());

  it('PUTs the file to the presigned URL', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve({ ok: true, status: 200 } as unknown as Response),
    );
    const file = new File(['hello'], 'a.pdf', { type: 'application/pdf' });

    await expect(
      uploadFile('https://s3.example/put', file, 'application/pdf'),
    ).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://s3.example/put');
    expect(init.method).toBe('PUT');
  });

  it('throws an ApiError when the PUT is rejected', async () => {
    stubFetch(() => Promise.resolve({ ok: false, status: 403 } as unknown as Response));
    const file = new File(['hello'], 'a.pdf', { type: 'application/pdf' });

    await expect(
      uploadFile('https://s3.example/put', file, 'application/pdf'),
    ).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('listJobs / getJob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GETs /jobs and returns the jobs array', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, { items: [] })));
    await expect(listJobs()).resolves.toEqual({ items: [] });
  });

  it('GETs /jobs/:id and returns a single job', async () => {
    const job = {
      jobId: 'j1',
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      docType: 'pdf',
      s3Key: 'uploads/j1',
      sizeBytes: 10,
      mode: 'sync',
      status: 'QUEUED',
      events: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    stubFetch(() => Promise.resolve(jsonResponse(200, job)));
    await expect(getJob('j1')).resolves.toEqual(job);
  });
});

describe('processJob (SSE)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards every parsed frame to onEvent and resolves once `done` arrives', async () => {
    stubFetch(() =>
      Promise.resolve(
        sseResponse([
          'data: {"type":"status","ts":"2026-01-01T00:00:00.000Z","jobId":"j1","status":"PROCESSING"}\n\n',
          'data: {"type":"done","ts":"2026-01-01T00:00:01.000Z"}\n\n',
        ]),
      ),
    );

    const events: unknown[] = [];
    await processJob('j1', (event) => events.push(event));

    expect(events).toEqual([
      { type: 'status', ts: '2026-01-01T00:00:00.000Z', jobId: 'j1', status: 'PROCESSING' },
      { type: 'done', ts: '2026-01-01T00:00:01.000Z' },
    ]);
  });

  it('throws STREAM_INCOMPLETE when the stream ends without a `done` frame', async () => {
    stubFetch(() =>
      Promise.resolve(
        sseResponse([
          'data: {"type":"status","ts":"2026-01-01T00:00:00.000Z","jobId":"j1","status":"PROCESSING"}\n\n',
        ]),
      ),
    );

    await expect(processJob('j1', noop)).rejects.toMatchObject({ code: 'STREAM_INCOMPLETE' });
  });

  it('flushes and applies a final frame that has no trailing blank line at EOF', async () => {
    stubFetch(() =>
      Promise.resolve(
        sseResponse([
          'data: {"type":"status","ts":"2026-01-01T00:00:00.000Z","jobId":"j1","status":"PROCESSING"}\n\n',
          // Final chunk: a complete frame, but the stream ends (EOF) before the
          // trailing blank-line separator ever arrives.
          'data: {"type":"done","ts":"2026-01-01T00:00:01.000Z"}',
        ]),
      ),
    );

    const events: unknown[] = [];
    await expect(processJob('j1', (event) => events.push(event))).resolves.toBeUndefined();

    expect(events).toEqual([
      { type: 'status', ts: '2026-01-01T00:00:00.000Z', jobId: 'j1', status: 'PROCESSING' },
      { type: 'done', ts: '2026-01-01T00:00:01.000Z' },
    ]);
  });
});

describe('chat (SSE)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends only jobId + message (session id is derived server-side, PLAN.md §2.6)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(sseResponse(['data: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}\n\n'])),
    );

    await chat('j1', 'hello', noop);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ jobId: 'j1', message: 'hello' });
  });

  it('streams token frames to onEvent in order', async () => {
    stubFetch(() =>
      Promise.resolve(
        sseResponse([
          'data: {"type":"token","text":"Hi"}\n\n',
          'data: {"type":"token","text":" there"}\n\n',
          'data: {"type":"done","ts":"2026-01-01T00:00:00.000Z"}\n\n',
        ]),
      ),
    );

    const events: unknown[] = [];
    await chat('j1', 'hello', (event) => events.push(event));

    expect(events).toEqual([
      { type: 'token', text: 'Hi' },
      { type: 'token', text: ' there' },
      { type: 'done', ts: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});
