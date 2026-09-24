import type { ReactElement, ReactNode } from 'react';

export interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

/** Generic bordered panel used to group related content across features. */
export function Card({ title, children, className = '' }: CardProps): ReactElement {
  return (
    <section
      className={`rounded-lg border border-black/8 bg-surface-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.03)] dark:border-white/8 ${className}`}
    >
      {title !== undefined && <h2 className="mb-3 text-sm font-semibold text-ink/80">{title}</h2>}
      {children}
    </section>
  );
}
