import type { ReactElement } from 'react';

import { Chips } from '../../components/Chips';
import type { JobResult } from '../../types/job';
import type { MetaField } from './ResultMetaGrid';
import { ResultMetaGrid } from './ResultMetaGrid';

export interface JobResultCardProps {
  result: JobResult;
}

function buildMetaFields(result: JobResult): MetaField[] {
  const fields: MetaField[] = [
    { label: 'Sentiment', value: result.sentiment },
    { label: 'Language', value: result.language },
    { label: 'Pages', value: String(result.pageCount) },
    { label: 'Words', value: String(result.wordCount) },
    { label: 'Extraction', value: result.extractionMethod },
    { label: 'Model', value: result.model },
  ];
  if (result.ucTable) fields.push({ label: 'UC table', value: result.ucTable });
  if (result.volumePath) fields.push({ label: 'Volume path', value: result.volumePath });
  if (result.databricksRunId)
    fields.push({ label: 'Databricks run', value: result.databricksRunId });
  return fields;
}

/** Summary card for a completed job's JobResult (PLAN §2.4). */
export function JobResultCard({ result }: JobResultCardProps): ReactElement {
  const entityChips = result.entities.map((entity) => `${entity.name} (${entity.type})`);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700 dark:text-slate-300">{result.summary}</p>

      {result.keyPoints.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600 dark:text-slate-400">
          {result.keyPoints.map((point, index) => (
            // LLM output can repeat a point verbatim; index disambiguates.
            <li key={`${index}-${point}`}>{point}</li>
          ))}
        </ul>
      )}

      <div>
        <h3 className="mb-1 text-xs font-semibold text-slate-500">Entities</h3>
        <Chips items={entityChips} emptyLabel="No entities extracted" />
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold text-slate-500">Topics</h3>
        <Chips items={result.topics} emptyLabel="No topics extracted" />
      </div>

      <ResultMetaGrid fields={buildMetaFields(result)} />
    </div>
  );
}
