import type { ReactElement } from 'react';

import { Chips } from '../../components/Chips';
import type { Entity, JobResult } from '../../types/job';
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

function groupEntitiesByType(entities: Entity[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const entity of entities) {
    const list = groups.get(entity.type) ?? [];
    list.push(entity.name);
    groups.set(entity.type, list);
  }
  return [...groups.entries()];
}

/** Summary card for a completed job's JobResult (PLAN §2.4): readable-measure summary, key
 * points, entity chips grouped by type, then a compact metadata grid (UI-PLAN §3). */
export function JobResultCard({ result }: JobResultCardProps): ReactElement {
  const entityGroups = groupEntitiesByType(result.entities);

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {result.summary}
      </p>

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
        {entityGroups.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">No entities extracted</p>
        ) : (
          <div className="space-y-1.5">
            {entityGroups.map(([type, names]) => (
              <div key={type} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                  {type}
                </span>
                <Chips items={names} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold text-slate-500">Topics</h3>
        <Chips items={result.topics} emptyLabel="No topics extracted" />
      </div>

      <ResultMetaGrid fields={buildMetaFields(result)} />
    </div>
  );
}
