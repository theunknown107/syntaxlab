#!/usr/bin/env node
/**
 * Bundle budget check — 12_PERFORMANCE.md §2
 *
 * Measures the real production output and fails on the hard budget. A budget
 * that is not enforced is a wish, so this runs in CI and in `npm run size`.
 *
 * Two thresholds, deliberately:
 *   HARD   fails the build. The point at which we stop and think.
 *   TARGET warns. Where the build should actually sit, leaving real room for
 *          a feature or a dependency bump without an emergency.
 */
import { gzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';

/**
 * Gzipped byte budgets. See 12_PERFORMANCE.md §2.3.
 *
 * "Initial JS" means what the browser fetches before first paint: the entry
 * chunk and the theme bootstrap. Worker chunks are *not* part of it — they are
 * fetched on first analysis, after paint — and are budgeted separately.
 *
 * Until M5 this summed every `.js` file under one "Initial JS" label. That was
 * deliberately conservative while the worker chunks were 1 KB stubs, and it
 * stopped being conservative and started being wrong once they carried two
 * parsers: the figure named a load that does not happen. The
 * everything-at-once case is still measured, by "Total precache", which is
 * what the service worker will actually pull down at M9.
 */
const BUDGETS = {
  initial: { hard: 200 * 1024, target: 170 * 1024, label: 'Initial JS' },
  workers: { hard: 120 * 1024, target: 80 * 1024, label: 'Worker chunks' },
  css: { hard: 20 * 1024, target: 15 * 1024, label: 'CSS' },
  total: { hard: 2 * 1024 * 1024, target: 1.5 * 1024 * 1024, label: 'Total precache' },
};

/** Worker chunks are emitted as `assets/<name>.worker-<hash>.js`. */
const isWorkerChunk = (path) => /\.worker-[\w-]+\.js$/.test(path);

const kb = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return files.flat();
}

async function main() {
  try {
    await stat(DIST);
  } catch {
    console.error(`No ${DIST}/ directory. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const files = await walk(DIST);
  const measured = await Promise.all(
    files.map(async (path) => {
      const contents = await readFile(path);
      return { path, raw: contents.byteLength, gzip: gzipSync(contents).byteLength };
    }),
  );

  const sum = (predicate) =>
    measured.filter(predicate).reduce((total, file) => total + file.gzip, 0);

  const actual = {
    initial: sum((file) => file.path.endsWith('.js') && !isWorkerChunk(file.path)),
    workers: sum((file) => isWorkerChunk(file.path)),
    css: sum((file) => file.path.endsWith('.css')),
    total: measured.reduce((total, file) => total + file.gzip, 0),
  };

  console.log('\nProduction bundle — gzipped\n');
  for (const file of measured.sort((a, b) => b.gzip - a.gzip)) {
    console.log(`  ${kb(file.gzip).padStart(10)}  ${file.path}`);
  }

  console.log('\nBudgets\n');
  let failed = false;
  let warned = false;

  for (const [key, budget] of Object.entries(BUDGETS)) {
    const value = actual[key];
    const overHard = value > budget.hard;
    const overTarget = value > budget.target;
    const status = overHard ? 'FAIL' : overTarget ? 'WARN' : 'ok';
    if (overHard) failed = true;
    if (overTarget && !overHard) warned = true;

    console.log(
      `  ${status.padEnd(5)} ${budget.label.padEnd(16)} ${kb(value).padStart(10)}` +
        `  target ${kb(budget.target)}  hard ${kb(budget.hard)}`,
    );
  }

  if (failed) {
    console.error('\nOver hard budget. See 12_PERFORMANCE.md §2.2 for the escalation order.');
    process.exit(1);
  }
  if (warned) {
    console.warn('\nOver target but within the hard budget. Investigate before it grows.');
  }
  console.log('');
}

await main();
