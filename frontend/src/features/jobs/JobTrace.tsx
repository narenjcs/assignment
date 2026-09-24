import type { ReactElement } from 'react';

import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { formatRelativeTime } from '../../lib/format';
import type { JobEvent } from '../../types/job';

export interface JobTraceProps {
  events: JobEvent[];
}

const RAIL_CLASSES: Record<JobEvent['source'], string> = {
  aws: 'border-l-brand-aws/50',
  databricks: 'border-l-brand-databricks/50',
  orchestrator: 'border-l-brand-orchestrator/50',
};

/** True for the first event, or the first event of a run from a different source — used to add
 * a little extra breathing room between provenance groups so the trace reads at a glance. */
function startsNewGroup(events: JobEvent[], index: number): boolean {
  return index === 0 || events[index - 1]?.source !== events[index]?.source;
}

/** Append-only agent trace timeline for a job (PLAN §2.4 `JobEvent[]`) — the primary visual in
 * Job detail now that the flow diagram is deferred. Left rail colour signals cloud provenance
 * (AWS / Databricks / orchestrator), tool names render in monospace, timestamps are relative,
 * and consecutive same-source events are grouped with extra spacing above each source change. */
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
    <ol className="space-y-1.5">
      {events.map((event, index) => (
        <li
          key={`${event.ts}-${index}`}
          className={`flex items-start gap-2 rounded-r-md border-l-2 py-1.5 pl-3 text-xs ${RAIL_CLASSES[event.source]} ${
            startsNewGroup(events, index) ? 'mt-2.5' : ''
          }`}
        >
          <Badge variant={event.source}>{event.agent}</Badge>
          <div className="min-w-0 flex-1">
            <p className="text-slate-600 dark:text-slate-300">
              {event.tool && (
                <span className="font-mono text-[11px] text-slate-400">{event.tool} · </span>
              )}
              {event.message}
            </p>
            <p className="text-[10px] tabular-nums text-slate-400">{formatRelativeTime(event.ts)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
