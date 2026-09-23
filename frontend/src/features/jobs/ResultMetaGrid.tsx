import type { ReactElement } from 'react';

export interface MetaField {
  label: string;
  value: string;
}

export interface ResultMetaGridProps {
  fields: MetaField[];
}

/** Small label/value grid for the extra metadata on a completed job's result. */
export function ResultMetaGrid({ fields }: ResultMetaGridProps): ReactElement {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
      {fields.map((field) => (
        <div key={field.label}>
          <dt className="text-slate-400">{field.label}</dt>
          <dd className="truncate font-medium text-slate-700 dark:text-slate-200">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}
