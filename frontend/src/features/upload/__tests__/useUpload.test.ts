import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUpload, getJob, processJob, uploadFile } from '../../../lib/api';
import { API_ERROR_CODES, ApiError } from '../../../lib/errors';
import type { Job } from '../../../types/job';
import { useUpload } from '../useUpload';

vi.mock('../../../lib/api', () => ({
  createUpload: vi.fn(),
  uploadFile: vi.fn(),
  getJob: vi.fn(),
  processJob: vi.fn(),
}));

const createUploadMock = vi.mocked(createUpload);
const uploadFileMock = vi.mocked(uploadFile);
const getJobMock = vi.mocked(getJob);
const processJobMock = vi.mocked(processJob);

function makeFile(): File {
  return new File(['content'], 'report.pdf', { type: 'application/pdf' });
}

describe('useUpload', () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it('does nothing when submit() is called without a file', async () => {
    const { result } = renderHook(() => useUpload());
    await act(async () => {
      await result.current.submit();
    });
    expect(createUploadMock).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });

  it('runs create -> upload -> stream for sync mode and reaches "done"', async () => {
    createUploadMock.mockResolvedValue({ jobId: 'j1', uploadUrl: 'https://s3/put', s3Key: 'k' });
    uploadFileMock.mockResolvedValue(undefined);
    processJobMock.mockResolvedValue(undefined);
    const onJobCreated = vi.fn();

    const { result } = renderHook(() => useUpload({ onJobCreated }));
    act(() => result.current.setFile(makeFile()));

    await act(async () => {
      await result.current.submit();
    });

    expect(onJobCreated).toHaveBeenCalledWith('j1');
    expect(uploadFileMock).toHaveBeenCalledWith(
      'https://s3/put',
      expect.any(File),
      'application/pdf',
    );
    expect(processJobMock).toHaveBeenCalled();
    await waitFor(() => expect(result.current.phase).toBe('done'));
  });

  it('skips the stream entirely for async mode', async () => {
    createUploadMock.mockResolvedValue({ jobId: 'j1', uploadUrl: 'https://s3/put', s3Key: 'k' });
    uploadFileMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useUpload());
    act(() => {
      result.current.setMode('async');
      result.current.setFile(makeFile());
    });

    await act(async () => {
      await result.current.submit();
    });

    expect(processJobMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.phase).toBe('done'));
  });

  it('re-fetches and calls onResync when the stream ends without `done`', async () => {
    createUploadMock.mockResolvedValue({ jobId: 'j1', uploadUrl: 'https://s3/put', s3Key: 'k' });
    uploadFileMock.mockResolvedValue(undefined);
    processJobMock.mockRejectedValue(
      new ApiError({ code: API_ERROR_CODES.STREAM_INCOMPLETE, message: 'stream closed early' }),
    );
    const resyncedJob = { jobId: 'j1', status: 'COMPLETED' } as unknown as Job;
    getJobMock.mockResolvedValue(resyncedJob);
    const onResync = vi.fn();

    const { result } = renderHook(() => useUpload({ onResync }));
    act(() => result.current.setFile(makeFile()));

    await act(async () => {
      await result.current.submit();
    });

    expect(onResync).toHaveBeenCalledWith(resyncedJob);
    await waitFor(() => expect(result.current.phase).toBe('done'));
  });

  it('sets phase to "error" and records the message when createUpload fails', async () => {
    createUploadMock.mockRejectedValue(new Error('quota exceeded'));

    const { result } = renderHook(() => useUpload());
    act(() => result.current.setFile(makeFile()));

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toBe('quota exceeded');
    expect(result.current.phase).toBe('error');
  });

  it('retries processJob on 409 JOB_NOT_PROCESSABLE and succeeds once the job is ready', async () => {
    vi.useFakeTimers();
    createUploadMock.mockResolvedValue({ jobId: 'j1', uploadUrl: 'https://s3/put', s3Key: 'k' });
    uploadFileMock.mockResolvedValue(undefined);
    processJobMock
      .mockRejectedValueOnce(
        new ApiError({ code: 'JOB_NOT_PROCESSABLE', message: 'not yet', status: 409 }),
      )
      .mockRejectedValueOnce(
        new ApiError({ code: 'JOB_NOT_PROCESSABLE', message: 'not yet', status: 409 }),
      )
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useUpload());
    act(() => result.current.setFile(makeFile()));

    let submitPromise!: Promise<void>;
    act(() => {
      submitPromise = result.current.submit();
    });

    // Two 409s, each followed by the 1.5s retry delay, before the third
    // attempt (the S3 trigger has caught up by then) succeeds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    await act(async () => {
      await submitPromise;
    });

    expect(processJobMock).toHaveBeenCalledTimes(3);
    expect(result.current.phase).toBe('done');
  });

  it('surfaces the error once JOB_NOT_PROCESSABLE retries are exhausted', async () => {
    vi.useFakeTimers();
    createUploadMock.mockResolvedValue({ jobId: 'j1', uploadUrl: 'https://s3/put', s3Key: 'k' });
    uploadFileMock.mockResolvedValue(undefined);
    processJobMock.mockRejectedValue(
      new ApiError({ code: 'JOB_NOT_PROCESSABLE', message: 'never ready', status: 409 }),
    );

    const { result } = renderHook(() => useUpload());
    act(() => result.current.setFile(makeFile()));

    let submitPromise!: Promise<void>;
    act(() => {
      submitPromise = result.current.submit();
    });

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
    }
    await act(async () => {
      await submitPromise;
    });

    // 1 initial attempt + 5 retries.
    expect(processJobMock).toHaveBeenCalledTimes(6);
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('never ready');
  });

  it('reset() clears file, phase, error, and stream events', async () => {
    createUploadMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useUpload());
    act(() => result.current.setFile(makeFile()));
    await act(async () => {
      await result.current.submit();
    });

    act(() => result.current.reset());

    expect(result.current.file).toBeNull();
    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.streamEvents).toEqual([]);
  });
});
