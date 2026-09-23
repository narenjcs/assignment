import type { ReactElement } from 'react';

export interface ChipsProps {
  items: string[];
  emptyLabel?: string;
}

/** Small wrapping list of neutral chips, used for entities/topics in the results card. */
export function Chips({ items, emptyLabel = 'None found' }: ChipsProps): ReactElement {
  if (items.length === 0) {
    return <p className="text-xs text-slate-400 dark:text-slate-500">{emptyLabel}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item, index) => (
        <li
          // LLM output can repeat an entity/topic verbatim; index disambiguates.
          key={`${index}-${item}`}
          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}
