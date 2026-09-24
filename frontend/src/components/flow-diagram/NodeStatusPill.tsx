import type { ReactElement } from 'react';

export interface NodeStatusPillProps {
  label: string;
  className: string;
}

/** Small rounded status pill ("Active" / "Completed" / "Skipped" / "Failed" / "Pending") shown
 * inside a node card via `foreignObject`, since SVG has no native rounded-pill primitive. */
export function NodeStatusPill({ label, className }: NodeStatusPillProps): ReactElement {
  return (
    <div
      className={`flex h-[14px] items-center justify-center rounded-full text-[8px] font-medium ${className}`}
    >
      {label}
    </div>
  );
}
