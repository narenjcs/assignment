import { useMemo, type ReactElement } from 'react';

import { Card } from '../../components/Card';
import { Dropzone } from '../../components/Dropzone';
import { Spinner } from '../../components/Spinner';
import type { Job } from '../../types/job';
import type { SseEvent } from '../../types/sse';
import { ModeCards } from './ModeCards';
import { useUpload, type UploadPhase, type UseUploadOptions } from './useUpload';
import { UploadStreamPreview } from './UploadStreamPreview';

export interface UploadPanelProps {
  onJobCreated?: (jobId: string) => void;
  onResync?: (job: Job) => void;
  onStreamEvent?: (event: SseEvent) => void;
}

const BUSY_PHASES = new Set(['creating', 'uploading', 'streaming']);

interface UploadActionProps {
  isFinished: boolean;
  isBusy: boolean;
  file: File | null;
  phase: UploadPhase;
  onReset: () => void;
  onSubmit: () => void;
}

/** "Start over" once a job has been created, otherwise the submit button. */
function UploadAction({
  isFinished,
  isBusy,
  file,
  phase,
  onReset,
  onSubmit,
}: UploadActionProps): ReactElement {
  if (isFinished) {
    return (
      <button
        type="button"
        onClick={onReset}
        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
      >
        Start over
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onSubmit}
      disabled={!file || isBusy}
      className="mt-3 w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isBusy ? <Spinner label={`${phase}…`} /> : 'Upload & process'}
    </button>
  );
}

/** Upload form: mode toggle, dropzone, submit; shows the live stream inline for sync mode. */
export function UploadPanel({
  onJobCreated,
  onResync,
  onStreamEvent,
}: UploadPanelProps): ReactElement {
  const options: UseUploadOptions = useMemo(
    () => ({ onJobCreated, onResync, onStreamEvent }),
    [onJobCreated, onResync, onStreamEvent],
  );
  const { mode, setMode, file, setFile, phase, error, streamEvents, submit, reset } =
    useUpload(options);
  const isBusy = BUSY_PHASES.has(phase);
  // Once a job has been created, hide the submit action entirely: clicking it
  // again would create a duplicate job from the same file. "Start over" must
  // be used first, which clears the selected file.
  const isFinished = phase === 'done' || phase === 'error';

  return (
    <Card title="Upload a document">
      <div className="mb-3">
        <ModeCards mode={mode} onChange={setMode} disabled={isBusy || isFinished} />
      </div>

      <Dropzone file={file} onFileSelected={setFile} disabled={isBusy || isFinished} />

      <UploadAction
        isFinished={isFinished}
        isBusy={isBusy}
        file={file}
        phase={phase}
        onReset={reset}
        onSubmit={() => void submit()}
      />

      {error && (
        <p role="alert" className="mt-2 text-xs text-state-failed">
          {error}
        </p>
      )}

      {mode === 'sync' && streamEvents.length > 0 && <UploadStreamPreview events={streamEvents} />}
    </Card>
  );
}
