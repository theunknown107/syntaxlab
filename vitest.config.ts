import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
