import { createServer } from 'node:http';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

/**
 * Serves `dist/` with the **real** production headers from `vercel.json`.
 *
 *   node scripts/serve-production.mjs [port] [root]
 *
 * The source of truth moved from `public/_headers` to `vercel.json` when the
 * host was reconciled: Vercel does not read the Cloudflare `_headers` format,
 * so that file was declaring a policy nobody served. Reading the deployed
 * configuration here is the whole point — a preview server that agrees with a
 * file production ignores proves nothing.
 *
 * `vite preview` serves no security headers at all, which means the entire
 * E2E suite validates the application under a policy that is not the one it
 * ships with. For most features that gap is harmless. For a service worker it
 * is not: a worker's CSP comes from the headers on its own script, so
 * `connect-src 'none'` applied to `/*` would block Workbox's precache fetches
 * — in production only, invisibly, after every test had passed.
 *
 * This exists so that class of bug is reachable from a test.
 */

const PORT = Number(process.argv[2] ?? 4183);

/**
 * The directory to serve. Defaults to the real build; the update suite passes
 * its own copy so it can rewrite a "deployed" service worker without every
 * other E2E project seeing an update banner appear mid-test.
 */
const ROOT = process.argv[3] ?? 'dist';

if (ROOT !== 'dist') {
  await mkdir(ROOT, { recursive: true });
  await cp('dist', ROOT, { recursive: true });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** Reads the header rules out of the deployed `vercel.json`. */
async function readHeaderRules() {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  return (config.headers ?? []).map((rule) => ({
    pattern: rule.source,
    headers: rule.headers.map((header) => [header.key, header.value]),
  }));
}

/**
 * Adjusts one header for the fact that this server speaks HTTP on localhost.
 *
 * Exactly one directive is dropped: `upgrade-insecure-requests`. In production
 * the origin is HTTPS and the directive is a no-op belt-and-braces measure;
 * here it makes WebKit rewrite every subresource URL to `https://localhost`,
 * which nothing is listening for, and the page fails to load at all. Chromium
 * and Firefox exempt localhost from the upgrade; WebKit does not.
 *
 * Nothing else is touched. Every directive that governs the service worker —
 * `script-src`, `connect-src`, `worker-src`, `default-src` — is served exactly
 * as production serves it, which is the entire reason this file exists.
 */
function localise(name, value) {
  if (name.toLowerCase() !== 'content-security-policy') return value;
  return value
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== 'upgrade-insecure-requests')
    .join('; ');
}

/**
 * Vercel matches `source` with path-to-regexp, and every rule in this
 * project's `vercel.json` is written in its regex form. Anchoring the pattern
 * at both ends is the same match Vercel performs.
 *
 * The CSP rules are deliberately *mutually exclusive* — the site-wide pattern
 * excludes `sw.js` and the Workbox chunk by negative lookahead — so no request
 * ever matches two rules carrying the same header key. That removes any
 * dependence on which rule would have won, here or at the edge.
 */
function matches(pattern, pathname) {
  return new RegExp(`^${pattern}$`).test(pathname);
}

const rules = await readHeaderRules();

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);

    // Every matching rule contributes its headers. The rules are written so
    // that two rules matching the same request never carry the same key,
    // which is why nothing here depends on an ordering Vercel does not
    // document.
    for (const rule of rules) {
      if (matches(rule.pattern, pathname)) {
        for (const [name, value] of rule.headers) response.setHeader(name, localise(name, value));
      }
    }

    if (pathname.endsWith('/')) pathname += 'index.html';
    // Contained to dist/: this serves a build, not the filesystem.
    const file = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));

    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch {
      // SPA fallback, matching the service worker's navigateFallback.
      try {
        const html = await readFile(join(ROOT, 'index.html'));
        response.setHeader('Content-Type', TYPES['.html']);
        response.statusCode = 200;
        response.end(html);
      } catch {
        response.statusCode = 404;
        response.end('not found');
      }
    }
  })();
});

server.listen(PORT, () => {
  console.log(`dist/ served with production headers on http://localhost:${PORT}`);
});
