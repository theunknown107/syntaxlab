import { createServer } from 'node:http';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

/**
 * Serves `dist/` with the **real** production headers from `public/_headers`.
 *
 *   node scripts/serve-production.mjs [port] [root]
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

/** Parses the Cloudflare `_headers` format: a path pattern, then indented headers. */
async function readHeaderRules() {
  const text = await readFile('public/_headers', 'utf8');
  const rules = [];
  let current = null;

  for (const raw of text.split('\n')) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!raw.startsWith(' ') && !raw.startsWith('\t')) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const line = raw.trim();
    const colon = line.indexOf(':');
    if (colon > 0 && current !== null) {
      current.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
    }
  }
  return rules;
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

function matches(pattern, pathname) {
  if (pattern.endsWith('/*')) return pathname.startsWith(pattern.slice(0, -1));
  // A `*` anywhere else, as in `/workbox-*.js`, matches within one segment.
  if (pattern.includes('*')) {
    const escaped = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
      .join('[^/]*');
    return new RegExp(`^${escaped}$`).test(pathname);
  }
  return pattern === pathname;
}

const rules = await readHeaderRules();

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);

    // Later rules win, so a specific `/sw.js` block overrides the `/*` block —
    // the same precedence Cloudflare Pages applies.
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
