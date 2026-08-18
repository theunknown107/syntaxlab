import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

/**
 * Bundle analysis is opt-in (`npm run analyze`) so ordinary builds stay fast
 * and never emit stats.html into dist/.
 */
const analyze = process.env.ANALYZE === '1';

export default defineConfig({
  plugins: [
    react(),
    ...(analyze ? [visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true })] : []),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    // Source maps must not be deployed (17_DEPLOYMENT.md §3.3): Cloudflare
    // publishes dist/ wholesale, so anything emitted there ships. They are
    // opt-in via SOURCEMAP=1 for CI artefact builds, and `hidden` even then so
    // no //# sourceMappingURL comment invites a browser to fetch them.
    sourcemap: process.env.SOURCEMAP === '1' ? 'hidden' : false,
    cssCodeSplit: true,
    reportCompressedSize: true,
  },
  server: { port: 5173, strictPort: false },
  preview: { port: 4173, strictPort: false },
});
