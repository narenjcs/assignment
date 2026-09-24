import type { ReactElement } from 'react';

export interface ViewFlowButtonProps {
  onClick: () => void;
}

/** Opens the architecture-flow dialog (UI-PLAN §1). Kept as its own component so both the
 * "no job selected" and normal states in JobDetail can share the exact same control. */
export function ViewFlowButton({ onClick }: ViewFlowButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-black/10 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
    >
      View flow
    </button>
  );
}
