import { useEffect, useRef, type ReactElement } from 'react';

import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { formatRelativeTime } from '../../lib/format';
import type { JobEvent } from '../../types/job';

export interface JobTraceProps {
  events: JobEvent[];
  /** Event indices to highlight — set when a matching FlowDiagram node is clicked. */
  highlightedIndices?: number[];
  onHoverEvent?: (index: number | null) => void;
}

const RAIL_CLASSES: Record<JobEvent['source'], string> = {
  aws: 'border-l-brand-aws/50',
  databricks: 'border-l-brand-databricks/50',
  orchestrator: 'border-l-brand-orchestrator/50',
};

/** Append-only agent trace timeline for a job (PLAN §2.4 JobEvent[]). Rows highlight when the
 * matching FlowDiagram node is clicked, and scroll into view the first time that happens; the
 * left rail is coloured by cloud provenance, matching the diagram bands. */
export function JobTrace({
  events,
  highlightedIndices = [],
  onHoverEvent,
}: JobTraceProps): ReactElement {
  const rowRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  useEffect(() => {
    const target = highlightedIndices[0];
    if (target === undefined) return;
    rowRefs.current.get(target)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightedIndices]);

  if (events.length === 0) {
    return (
      <EmptyState
        title="No agent activity yet"
        description="Events appear once the job starts processing."
      />
    );
  }

  const highlighted = new Set(highlightedIndices);

  return (
    <ol className="space-y-1.5">
      {events.map((event, index) => (
        <li
          key={`${event.ts}-${index}`}
          ref={(el) => {
            if (el) rowRefs.current.set(index, el);
            else rowRefs.current.delete(index);
          }}
          onMouseEnter={() => onHoverEvent?.(index)}
          onMouseLeave={() => onHoverEvent?.(null)}
          className={`flex items-start gap-2 rounded-r-md border-l-2 py-1 pl-2 text-xs ${RAIL_CLASSES[event.source]} ${
            highlighted.has(index) ? 'bg-accent/10 ring-1 ring-accent/40' : ''
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
            <p className="text-[10px] text-slate-400">{formatRelativeTime(event.ts)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
