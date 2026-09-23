import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite config for the DocIntel SPA. Runtime API base URL is not baked in here;
// it is resolved at startup by src/lib/config.ts (public/config.json, falling
// back to VITE_API_URL from the build-time env).
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
