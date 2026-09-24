import type { ReactElement } from 'react';

import { Badge } from '../../components/Badge';
import { Spinner } from '../../components/Spinner';
import { JOB_STATUSES, type JobStatus } from '../../types/job';
import type { SseEvent } from '../../types/sse';

export interface UploadStreamPreviewProps {
  events: SseEvent[];
}

function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

function statusNote(status: string): ReactElement {
  return isJobStatus(status) ? (
    <Badge variant="status" status={status}>
      {status}
    </Badge>
  ) : (
    <Badge variant="orchestrator">{status}</Badge>
  );
}

function noteFor(event: SseEvent): ReactElement | null {
  if (event.type === 'status') return statusNote(event.status);
  if (event.type === 'tool') return <Badge variant={event.source}>{event.name}</Badge>;
  if (event.type === 'error')
    return <span className="text-state-failed">{event.error.message}</span>;
  return null;
}

/** Live view of a sync processJob() stream: status/tool notes + the streaming summary text. */
export function UploadStreamPreview({ events }: UploadStreamPreviewProps): ReactElement {
  const notes = events.filter((event) => event.type !== 'token' && event.type !== 'result');
  const tokenText = events
    .filter((event) => event.type === 'token')
    .map((event) => event.text)
    .join('');
  const isDone = events.some((event) => event.type === 'done');

  return (
    <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
      <ul className="flex flex-wrap items-center gap-1.5">
        {notes.map((event, index) => (
          // Frames have no id of their own; index is stable for this append-only list.
          <li key={index}>{noteFor(event)}</li>
        ))}
        {!isDone && <Spinner label="Streaming" />}
      </ul>
      {tokenText && (
        <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{tokenText}</p>
      )}
    </div>
  );
}
