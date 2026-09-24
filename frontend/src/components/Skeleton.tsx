import type { ReactElement } from 'react';

export interface SkeletonProps {
  count?: number;
}

/** Shimmering placeholder rows shown while content loads, instead of a spinner (UI-PLAN §3). */
export function Skeleton({ count = 3 }: SkeletonProps): ReactElement {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
      ))}
    </div>
  );
}
