import type { ReactElement } from 'react';

import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { formatRelativeTime } from '../../lib/format';
import type { JobEvent } from '../../types/job';

export interface JobTraceProps {
  events: JobEvent[];
}

/** Append-only agent trace timeline for a job (PLAN §2.4 JobEvent[]). */
export function JobTrace({ events }: JobTraceProps): ReactElement {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No agent activity yet"
        description="Events appear once the job starts processing."
      />
    );
  }

  return (
    <ol className="space-y-2">
      {events.map((event, index) => (
        <li key={`${event.ts}-${index}`} className="flex items-start gap-2 text-xs">
          <Badge variant={event.source}>{event.agent}</Badge>
          <div className="min-w-0 flex-1">
            <p className="text-slate-600 dark:text-slate-300">
              {event.tool && (
                <span className="font-mono text-[11px] text-slate-400">{event.tool} · </span>
              )}
              {event.message}
            </p>
            <p className="text-[10px] text-slate-400">{formatRelativeTime(event.ts)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
