import type { ReactElement } from 'react';

import { Badge } from '../components/Badge';

/** App shell header: product name/tagline plus a legend of the two cloud providers involved. */
export function AppHeader(): ReactElement {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div>
        <h1 className="text-xl font-bold text-ink">DocIntel</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cross-cloud agentic document intelligence
        </p>
      </div>
      <div className="flex gap-2">
        <Badge variant="aws">AWS</Badge>
        <Badge variant="databricks">Databricks</Badge>
        <Badge variant="orchestrator">Orchestrator</Badge>
      </div>
    </header>
  );
}
