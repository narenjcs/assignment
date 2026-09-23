import type { ReactElement } from 'react';

import { Badge } from '../../components/Badge';
import { formatRelativeTime } from '../../lib/format';
import type { Job } from '../../types/job';

export interface JobRowProps {
  job: Job;
  isSelected: boolean;
  onSelect: (jobId: string) => void;
}

/** One selectable row in JobsList. */
export function JobRow({ job, isSelected, onSelect }: JobRowProps): ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(job.jobId)}
        aria-current={isSelected ? 'true' : undefined}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
          isSelected
            ? 'bg-brand-aws/10 ring-1 ring-brand-aws'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-slate-700 dark:text-slate-200">
            {job.fileName}
          </span>
          <span className="block text-xs text-slate-400">
            {job.mode} · {formatRelativeTime(job.createdAt)}
          </span>
        </span>
        <Badge variant="status" status={job.status}>
          {job.status}
        </Badge>
      </button>
    </li>
  );
}
