import type { ReactElement, ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
}

/** Placeholder shown for empty lists / no-selection states. */
export function EmptyState({ title, description, icon }: EmptyStateProps): ReactElement {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
      {icon !== undefined && (
        <span aria-hidden="true" className="text-2xl text-slate-400">
          {icon}
        </span>
      )}
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {description !== undefined && (
        <p className="text-xs text-slate-400 dark:text-slate-500">{description}</p>
      )}
    </div>
  );
}
