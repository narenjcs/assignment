import type { ReactElement } from 'react';

import type { JobMode } from '../../types/job';

export interface ModeCardsProps {
  mode: JobMode;
  onChange: (mode: JobMode) => void;
  disabled?: boolean;
}

interface ModeCopy {
  mode: JobMode;
  headline: string;
  body: string;
  detail: string;
}

// Copy from docs/UI-PLAN.md §2 — sync/async are a *transport* choice, not a business-logic one.
const MODE_COPY: readonly ModeCopy[] = [
  {
    mode: 'sync',
    headline: 'Watch it happen',
    body: 'Streams tokens live as the agents work. Best for a demo.',
    detail: 'Browser holds an SSE connection to the API Lambda',
  },
  {
    mode: 'async',
    headline: 'Fire and forget',
    body: 'Returns immediately; the job runs in the background and the list updates. Best for bulk or slow documents.',
    detail: 'S3 event triggers the orchestrator; UI polls',
  },
];

function cardClasses(isSelected: boolean): string {
  const base = 'flex-1 cursor-pointer rounded-lg border p-3 text-left';
  const tone = isSelected
    ? 'border-accent bg-accent/5 ring-1 ring-accent'
    : 'border-black/8 hover:border-black/15 dark:border-white/10 dark:hover:border-white/20';
  return `${base} ${tone}`;
}

/** Sync/async mode picker (UI-PLAN §2): two explanatory cards in place of bare radio buttons. */
export function ModeCards({ mode, onChange, disabled = false }: ModeCardsProps): ReactElement {
  return (
    <div>
      <fieldset className="flex flex-col gap-2 sm:flex-row" disabled={disabled}>
        <legend className="sr-only">Processing mode</legend>
        {MODE_COPY.map((copy) => (
          <label key={copy.mode} className={cardClasses(mode === copy.mode)}>
            <span className="flex items-center gap-1.5">
              <input
                type="radio"
                name="mode"
                value={copy.mode}
                checked={mode === copy.mode}
                onChange={() => onChange(copy.mode)}
                className="accent-accent"
              />
              <span className="text-sm font-semibold text-ink/90">{copy.headline}</span>
            </span>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{copy.body}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-400 dark:text-slate-500">
              {copy.detail}
            </p>
          </label>
        ))}
      </fieldset>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Sync and async are about <strong className="font-semibold">how you watch</strong>, not what
        runs — both use the same agents. The document type decides the cloud: DOCX stays in AWS, PDF
        is processed in Databricks.
      </p>
    </div>
  );
}
