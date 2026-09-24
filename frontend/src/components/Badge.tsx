import type { ReactElement, ReactNode } from 'react';

import type { JobStatus } from '../types/job';

export type BadgeVariant = 'aws' | 'databricks' | 'orchestrator' | 'status';

export interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
  /** Required when variant === 'status'; picks the colour for that status. */
  status?: JobStatus;
}

const VARIANT_CLASSES: Record<'aws' | 'databricks' | 'orchestrator', string> = {
  aws: 'bg-brand-aws/10 text-brand-aws border-brand-aws/40',
  databricks: 'bg-brand-databricks/10 text-brand-databricks border-brand-databricks/40',
  orchestrator: 'bg-brand-orchestrator/10 text-brand-orchestrator border-brand-orchestrator/40',
};

// Job/step STATE colours (queued/in-flight/done/failed) — a cool hue family, deliberately
// distinct from the warm AWS/Databricks provenance colours above (docs/UI-PLAN.md §3.1).
const STATUS_CLASSES: Record<JobStatus, string> = {
  PENDING_UPLOAD: 'bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-300',
  UPLOADED: 'bg-state-queued/10 text-state-queued border-state-queued/30',
  QUEUED: 'bg-state-queued/10 text-state-queued border-state-queued/30',
  PROCESSING: 'bg-accent/10 text-accent border-accent/30',
  COMPLETED: 'bg-state-done/10 text-state-done border-state-done/30',
  FAILED: 'bg-state-failed/10 text-state-failed border-state-failed/30',
};

function resolveClasses(variant: BadgeVariant, status?: JobStatus): string {
  if (variant === 'status') return status ? STATUS_CLASSES[status] : STATUS_CLASSES.PENDING_UPLOAD;
  return VARIANT_CLASSES[variant];
}

/** Small pill label. Colour always pairs with text so meaning isn't colour-only. */
export function Badge({ variant, status, children }: BadgeProps): ReactElement {
  const classes = resolveClasses(variant, status);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {children}
    </span>
  );
}
