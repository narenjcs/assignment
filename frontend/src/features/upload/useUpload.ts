import { useCallback, useState } from 'react';

import { API_ERROR_CODES, ApiError } from '../../lib/errors';
import { createUpload, getJob, processJob, uploadFile } from '../../lib/api';
import { contentTypeFor } from '../../lib/fileValidation';
import type { Job, JobMode } from '../../types/job';
import type { SseEvent } from '../../types/sse';

export type UploadPhase = 'idle' | 'creating' | 'uploading' | 'streaming' | 'done' | 'error';

export interface UseUploadOptions {
  /** Fired as soon as the job exists server-side, so the caller can select/refresh it. */
  onJobCreated?: ((jobId: string) => void) | undefined;
  /** Fired when a sync stream closes without `done`, after the client re-fetches the job. */
  onResync?: ((job: Job) => void) | undefined;
}

export interface UseUploadResult {
  mode: JobMode;
  setMode: (mode: JobMode) => void;
  file: File | null;
  setFile: (file: File) => void;
  phase: UploadPhase;
  error: string | null;
  streamEvents: SseEvent[];
  submit: () => Promise<void>;
  reset: () => void;
}

interface RunUploadDeps {
  onStreamEvent: (event: SseEvent) => void;
  onPhaseChange: (phase: UploadPhase) => void;
  options: UseUploadOptions;
}

// The S3 create-object trigger can lag the browser's PUT by a few hundred ms
// (PLAN.md §2.6): the API answers 409 JOB_NOT_PROCESSABLE in that window, and
// clients are expected to retry a few times with a short delay.
const JOB_NOT_PROCESSABLE = 'JOB_NOT_PROCESSABLE';
const JOB_NOT_PROCESSABLE_MAX_RETRIES = 5;
const JOB_NOT_PROCESSABLE_RETRY_DELAY_MS = 1_500;

// A stream that never resolved cleanly still needs the job's true (server)
// outcome reflected in the UI, since the client can no longer trust its own
// in-memory event log.
const RESYNC_CODES: readonly string[] = [
  API_ERROR_CODES.STREAM_INCOMPLETE,
  API_ERROR_CODES.TIMEOUT,
  API_ERROR_CODES.NETWORK,
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isJobNotProcessable(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.code === JOB_NOT_PROCESSABLE;
}

/** Re-fetches the job and pushes a synthetic `done` so the preview stops spinning. */
async function resyncAfterStreamFailure(jobId: string, deps: RunUploadDeps): Promise<void> {
  deps.onStreamEvent({ type: 'done', ts: new Date().toISOString() });
  deps.options.onResync?.(await getJob(jobId));
}

async function runSyncStream(jobId: string, deps: RunUploadDeps): Promise<void> {
  for (let attempt = 0; attempt <= JOB_NOT_PROCESSABLE_MAX_RETRIES; attempt += 1) {
    try {
      await processJob(jobId, deps.onStreamEvent);
      return;
    } catch (err) {
      if (isJobNotProcessable(err) && attempt < JOB_NOT_PROCESSABLE_MAX_RETRIES) {
        await sleep(JOB_NOT_PROCESSABLE_RETRY_DELAY_MS);
        continue;
      }
      if (err instanceof ApiError && RESYNC_CODES.includes(err.code)) {
        await resyncAfterStreamFailure(jobId, deps);
        return;
      }
      throw err;
    }
  }
}

async function runUploadFlow(file: File, mode: JobMode, deps: RunUploadDeps): Promise<void> {
  const contentType = file.type || contentTypeFor(file.name);
  const created = await createUpload({ fileName: file.name, contentType, mode });
  deps.options.onJobCreated?.(created.jobId);
  deps.onPhaseChange('uploading');
  await uploadFile(created.uploadUrl, file, contentType);
  if (mode !== 'sync') return;
  deps.onPhaseChange('streaming');
  await runSyncStream(created.jobId, deps);
}

/** Drives the upload flow (see docs/PLAN.md §2.2): createUpload → uploadFile → live stream if sync. */
export function useUpload(options: UseUploadOptions = {}): UseUploadResult {
  const [mode, setMode] = useState<JobMode>('sync');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<SseEvent[]>([]);

  const onStreamEvent = useCallback((event: SseEvent) => {
    setStreamEvents((prev) => [...prev, event]);
  }, []);

  const submit = useCallback(async () => {
    if (!file) return;
    setError(null);
    setStreamEvents([]);
    setPhase('creating');
    try {
      await runUploadFlow(file, mode, { onStreamEvent, onPhaseChange: setPhase, options });
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setPhase('error');
    }
  }, [file, mode, onStreamEvent, options]);

  const reset = useCallback(() => {
    setFile(null);
    setPhase('idle');
    setError(null);
    setStreamEvents([]);
  }, []);

  return { mode, setMode, file, setFile, phase, error, streamEvents, submit, reset };
}
