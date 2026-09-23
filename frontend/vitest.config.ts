import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

// Test config layered on top of the app's Vite config, per Vitest's
// recommended pattern (https://vitest.dev/config/) so plugins (React,
// Tailwind) stay in sync between dev/build and test.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/testSetup.ts'],
      css: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'text-summary'],
        include: ['src/lib/**/*.ts', 'src/features/*/use*.ts'],
        exclude: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
      },
    },
  }),
);
