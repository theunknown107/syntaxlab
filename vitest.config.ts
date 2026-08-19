import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Mirrors the `define` in vite.config.ts, so a build-time constant is not
  // undefined under test and a code path that reads it can be exercised.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    // No globals: tests import describe/it/expect explicitly from 'vitest'.
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      // Excluded from coverage because they contain no branching logic:
      // entry points, type-only modules, and the worker bootstraps (M2).
      exclude: ['src/main.tsx', 'src/**/*.d.ts', 'src/**/index.ts'],
    },
  },
});
