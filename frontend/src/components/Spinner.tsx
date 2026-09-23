import type { ReactElement } from 'react';

export interface SpinnerProps {
  label?: string;
}

/** Small animated loading indicator; the label stays for screen readers even when hidden visually. */
export function Spinner({ label = 'Loading' }: SpinnerProps): ReactElement {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-500">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-aws"
      />
      <span>{label}</span>
    </span>
  );
}
