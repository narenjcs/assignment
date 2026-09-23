import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, parse } from 'node:path';

/**
 * Walks up from `startDir` looking for the repo root: the directory whose `package.json` has
 * `"name": "docintel"` (review round 1, item 10). A fixed `../../..` depth silently resolves to
 * the wrong directory (or one that happens to exist but isn't the repo root) the moment this
 * file is compiled to a different depth, e.g. a `dist/` output layout — every asset path would
 * then point at a nonexistent directory with no clear error. Walking up to a marker is layout-
 * independent: it works whether this file runs from `lib/` (ts-node/tsx) or `dist/lib/` (a
 * compiled build), as long as the marker itself isn't moved.
 */
/** True when `dir` contains the marker `package.json` (`"name": "docintel"`). */
function isRepoRootMarker(dir: string): boolean {
  const candidate = join(dir, 'package.json');
  if (!existsSync(candidate)) {
    return false;
  }
  try {
    const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { name?: unknown };
    return pkg.name === 'docintel';
  } catch {
    // Not valid JSON (or unreadable) — it isn't our marker; keep walking up.
    return false;
  }
}

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (!isRepoRootMarker(dir)) {
    const parentDir = dirname(dir);
    if (parentDir === dir || parse(dir).root === dir) {
      throw new Error(
        `Could not locate the repo root (a package.json with "name": "docintel") walking up ` +
          `from ${startDir}. Asset paths cannot be resolved.`,
      );
    }
    dir = parentDir;
  }
  return dir;
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

export interface AssetPaths {
  readonly lambdasDir: string;
  readonly toolsJsonPath: string;
  readonly docxAgentZipPath: string;
  readonly orchestratorZipPath: string;
  readonly frontendDistPath: string;
}

/** The subset of `DocIntelStackProps` this module needs — kept local to avoid a circular import. */
export interface AssetPathOverrides {
  readonly lambdasDir?: string;
  readonly toolsJsonPath?: string;
  readonly docxAgentZipPath?: string;
  readonly orchestratorZipPath?: string;
  readonly frontendDistPath?: string;
}

/** Resolves every on-disk asset path, defaulting to this repo's real build outputs (tests can override). */
export function resolveAssetPaths(props: AssetPathOverrides): AssetPaths {
  return {
    lambdasDir: props.lambdasDir ?? join(repoRoot, 'aws', 'lambdas'),
    toolsJsonPath: props.toolsJsonPath ?? join(repoRoot, 'aws', 'lambdas', 'tools.json'),
    docxAgentZipPath:
      props.docxAgentZipPath ?? join(repoRoot, 'aws', 'agents', 'dist', 'docx_agent.zip'),
    orchestratorZipPath:
      props.orchestratorZipPath ?? join(repoRoot, 'aws', 'agents', 'dist', 'orchestrator.zip'),
    frontendDistPath: props.frontendDistPath ?? join(repoRoot, 'frontend', 'dist'),
  };
}
