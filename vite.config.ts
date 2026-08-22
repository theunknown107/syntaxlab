import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import pkg from './package.json' with { type: 'json' };

/**
 * Bundle analysis is opt-in (`npm run analyze`) so ordinary builds stay fast
 * and never emit stats.html into dist/.
 */
const analyze = process.env.ANALYZE === '1';

export default defineConfig({
  // Stamped in at build time so an export file records which build wrote it,
  // rather than the app importing package.json into the bundle.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      /*
       * Service worker — 07_PWA_OFFLINE.md §2
       *
       * `generateSW`, because the caching need is "precache everything, serve
       * from cache" and Workbox already does exactly that. A hand-written
       * service worker would be more code for identical behaviour, and a
       * service-worker bug is the worst class of bug this app can ship: it
       * persists across reloads and can lock a user out of their own copy.
       *
       * `injectRegister: null` — registration is ours
       * (`infrastructure/pwa/registerServiceWorker.ts`). The plugin's helper
       * pulls `workbox-window` into the application bundle, and the native
       * API expresses the update lifecycle we want in about forty lines.
       */
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: null,
      // The dev server has no service worker at all: a stale SW during
      // development is a debugging trap, and there is nothing to test offline
      // that the production build does not test better.
      devOptions: { enabled: false },
      manifestFilename: 'manifest.webmanifest',
      includeAssets: [],
      manifest: {
        name: 'SyntaxLab — Regex, JSON & Cron Explainer',
        short_name: 'SyntaxLab',
        description:
          'Understand regular expressions, JSON and cron schedules. Runs entirely in your browser.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        // The *default* theme, deliberately. The manifest is a static build
        // artefact and a splash screen cannot follow a runtime-customised
        // theme (07_PWA_OFFLINE.md §6).
        background_color: '#0a0e0c',
        theme_color: '#0a0e0c',
        categories: ['developer', 'utilities', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Cron joined the list at v1.1.0, when the mode became real. The rule
        // that kept it out until then still stands: promising a mode in
        // metadata that the interface does not have is the same defect as a
        // disabled tab. `?mode=` is read by `applyModeFromUrl` and then
        // removed from the address bar.
        shortcuts: [
          { name: 'New Regex', url: '/?mode=regex' },
          { name: 'New JSON', url: '/?mode=json' },
          { name: 'New Cron', url: '/?mode=cron' },
        ],
      },
      workbox: {
        /*
         * Precache completeness is the whole game (§2.4). `js` covers the
         * entry chunk *and* the two worker chunks *and* theme-bootstrap.js;
         * missing a worker chunk turns every analysis into a silent failure
         * offline, and works perfectly in development.
         */
        // `ico` is here for `favicon.ico`: without it the one icon a browser
        // requests entirely on its own is the one asset that 404s offline.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,woff2}'],
        // Not runtime assets: `stats.html` is a build artefact, the icons
        // README is documentation, and robots.txt is meaningless offline.
        globIgnores: ['**/robots.txt', '**/stats.html', '**/icons/README.md'],
        navigateFallback: 'index.html',
        // Old precaches from previous revisions, and only those.
        cleanupOutdatedCaches: true,
        // Never: the new worker waits until the user consents (§4.1).
        skipWaiting: false,
        clientsClaim: false,
        // No runtime caching. The app issues no requests that were unknown at
        // build time, and `connect-src 'none'` blocks the APIs that would make
        // them. A strategy for traffic that does not exist is configuration
        // with no behaviour (§2.2).
        runtimeCaching: [],
      },
    }),
    // Cast because rollup-plugin-visualizer is typed against its own copy of
    // the rollup types, which is structurally the same plugin shape but not
    // the identical one Vite re-exports.
    ...(analyze
      ? [
          visualizer({
            filename: 'stats.html',
            gzipSize: true,
            brotliSize: true,
          }) as PluginOption,
        ]
      : []),
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
