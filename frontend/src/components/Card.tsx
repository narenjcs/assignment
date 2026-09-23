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
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {title !== undefined && (
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
      )}
      {children}
    </section>
  );
}
