import { z } from 'zod';

// Runtime config loaded from /config.json (written by CDK at deploy time),
// falling back to the build-time VITE_API_URL for local dev. See
// docs/DEVELOPMENT.md §12 ("Config: read env once ... into a typed,
// validated object; modules import the object, never process.env directly").

const ConfigSchema = z.object({
  apiUrl: z.string().min(1),
});
export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

function readFallbackConfig(): AppConfig {
  const apiUrl = import.meta.env.VITE_API_URL;
  const parsed = ConfigSchema.safeParse({ apiUrl });
  if (!parsed.success) {
    throw new Error(
      'DocIntel: no API URL configured. Provide /config.json ({"apiUrl": "..."}) or set VITE_API_URL.',
    );
  }
  return parsed.data;
}

async function readRuntimeConfig(): Promise<AppConfig | null> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const parsed = ConfigSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Loads and memoizes the runtime config. Safe to call from multiple call
 * sites (api.ts calls it before every request); the network fetch only
 * happens once, cached until the page reloads (Factory-with-cache pattern,
 * DEVELOPMENT.md §9 — no side effect at import time).
 */
export async function getConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;
  const runtimeConfig = await readRuntimeConfig();
  cachedConfig = runtimeConfig ?? readFallbackConfig();
  return cachedConfig;
}

/** Test-only escape hatch to reset the memoized config between test cases. */
export function resetConfigCache(): void {
  cachedConfig = null;
}
