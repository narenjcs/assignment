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

const STATUS_CLASSES: Record<JobStatus, string> = {
  PENDING_UPLOAD: 'bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-300',
  UPLOADED: 'bg-sky-500/10 text-sky-600 border-sky-500/30 dark:text-sky-300',
  QUEUED: 'bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-300',
  PROCESSING: 'bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-300',
  COMPLETED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-300',
  FAILED: 'bg-red-500/10 text-red-600 border-red-500/30 dark:text-red-300',
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
