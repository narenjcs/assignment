import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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
