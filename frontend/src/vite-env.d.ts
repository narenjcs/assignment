/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time fallback API base URL; see lib/config.ts. Prefer /config.json at runtime. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
