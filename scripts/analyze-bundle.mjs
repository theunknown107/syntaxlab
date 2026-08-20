import { readFileSync } from 'node:fs';

/**
 * Bundle composition by package — 12_PERFORMANCE.md §12.2
 *
 *   npm run analyze && node scripts/analyze-bundle.mjs
 *
 * `rollup-plugin-visualizer` writes an interactive treemap, which is the wrong
 * shape for a report and for a diff. This reads the data it embeds and prints
 * gzipped bytes grouped by npm package or app directory, which is the number a
 * budget decision is actually made on.
 */

const html = readFileSync('stats.html', 'utf8');
const match = /const data = (\{[\s\S]*?\});\n/.exec(html);
if (match?.[1] === undefined)
  throw new Error('stats.html has no embedded data — run `npm run analyze` first');
const data = JSON.parse(match[1]);

const SEP = String.fromCharCode(92);
const NODE_MODULES = new RegExp(
  'node_modules[' +
    SEP +
    SEP +
    '/]((@[^' +
    SEP +
    SEP +
    '/]+[' +
    SEP +
    SEP +
    '/][^' +
    SEP +
    SEP +
    '/]+)|([^' +
    SEP +
    SEP +
    '/]+))',
);
const APP = new RegExp('[' + SEP + SEP + '/]src[' + SEP + SEP + '/](.*)');
const SPLIT = new RegExp('[' + SEP + SEP + '/]');

/** npm package name, or the app directory two levels deep. */
function group(id) {
  const dependency = NODE_MODULES.exec(id);
  if (dependency?.[1] !== undefined) return dependency[1].split(SEP).join('/');
  const app = APP.exec(id);
  if (app?.[1] === undefined) return `other: ${id}`;
  return `app: ${app[1].split(SPLIT).slice(0, 2).join('/')}`;
}

const byGroup = new Map();
for (const meta of Object.values(data.nodeMetas)) {
  for (const partUid of Object.values(meta.moduleParts)) {
    const part = data.nodeParts[partUid];
    if (part === undefined) continue;
    const key = group(meta.id.replace(/^\0/, ''));
    byGroup.set(key, (byGroup.get(key) ?? 0) + (part.gzipLength ?? 0));
  }
}

const rows = [...byGroup].sort(([, a], [, b]) => b - a);
const total = rows.reduce((sum, [, bytes]) => sum + bytes, 0);
console.log(
  `\nBundle composition — ${(total / 1024).toFixed(1)} KB gz across ${rows.length} groups\n`,
);
for (const [name, bytes] of rows) {
  if (bytes < 512) continue;
  console.log(`  ${(bytes / 1024).toFixed(2).padStart(7)} KB  ${name}`);
}
console.log('');
