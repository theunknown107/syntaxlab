import { analyzeCron } from '@/domain/cron/analyze';
import { parseCron } from '@/domain/cron/parser';
import { tokenize } from '@/domain/cron/tokenizer';
import { LIMITS } from '@/domain/shared/limits';

/**
 * Measures cron analysis — 12_PERFORMANCE.md §13
 *
 * Run with:
 *
 *   npm run measure:cron
 *
 * Numbers, not guesses. Cron is the smallest input this app parses — five
 * fields, at most a thousand characters — so the honest question is not
 * "is it fast enough" but "is there any input that is not". This measures the
 * ordinary case, the pathological case at the input limit, and the worst
 * expansion the grammar allows, and reports the slowest of them.
 *
 * The budget is the one every analysis in this app shares: a keystroke's worth
 * of work has to fit inside a frame, so the p99 for a realistic expression is
 * expected to be far below 16 ms. It is written as a floor to beat rather than
 * a target to approach, because a cron expression is two orders of magnitude
 * smaller than the regex and JSON inputs the same pipeline already handles.
 */

const FRAME_MS = 16;

interface Case {
  readonly label: string;
  readonly source: string;
  readonly note: string;
}

const maxTerms = LIMITS.cron.maxTermsPerField;

const CASES: readonly Case[] = [
  { label: 'wildcard', source: '* * * * *', note: 'the largest expansion of the shortest input' },
  { label: 'typical', source: '*/15 9-17 * * 1-5', note: 'the shape most schedules take' },
  { label: 'names', source: '0 9-17 1,15 JAN-JUN MON-FRI', note: 'names in two fields' },
  { label: 'macro', source: '@weekly', note: 'expanded to five fields before parsing' },
  {
    label: 'wide list',
    source: `${Array.from({ length: maxTerms }, (_, index) => String(index % 60)).join(',')} * * * *`,
    note: `${String(maxTerms)} terms — the per-field limit`,
  },
  {
    label: 'nested steps',
    source: '0-59/2,0-59/3,0-59/5,0-59/7 0-23/2 1-31/2 1-12/2 0-6/2',
    note: 'a step on a range in every field',
  },
  {
    label: 'at the input limit',
    source: '1,'.repeat(Math.floor(LIMITS.cron.input / 2) - 1) + '1 * * * *',
    note: `${String(LIMITS.cron.input)} characters — refused, and the refusal is the hot path`,
  },
  {
    label: 'foreign dialect',
    source: '0 0 12 * * ?',
    note: 'refused at the field count, before any field is read',
  },
  { label: 'all errors', source: '99 99 99 99 99', note: 'five failing fields, all recovered' },
];

/**
 * Browser-local mode is measured separately because it does strictly more
 * work: resolving the zone through `Intl`, and twelve monthly offset probes to
 * decide whether the zone observes daylight saving. If that ever becomes
 * expensive, it should show up here rather than in a user's editor.
 */
const LOCAL_CASE = { label: 'typical, browser-local', source: '*/15 9-17 * * 1-5' };

const RUNS = 2000;
const WARMUP = 200;

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

function time(run: () => void): { p50: number; p99: number; max: number } {
  for (let i = 0; i < WARMUP; i += 1) run();

  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: percentile(samples, 0.5),
    p99: percentile(samples, 0.99),
    max: samples[samples.length - 1] ?? 0,
  };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function ms(value: number): string {
  return `${value.toFixed(3)} ms`;
}

const rows: { label: string; note: string; p50: number; p99: number; max: number }[] = [];

for (const testCase of CASES) {
  const stats = time(() => {
    analyzeCron(testCase.source, { timezoneMode: 'utc' });
  });
  rows.push({ label: testCase.label, note: testCase.note, ...stats });
}

console.log(`\nCron analysis — ${String(RUNS)} runs each, after ${String(WARMUP)} warmup runs\n`);
console.log(`  ${pad('case', 26)}${pad('p50', 12)}${pad('p99', 12)}${pad('max', 12)}note`);
for (const row of rows) {
  console.log(
    `  ${pad(row.label, 26)}${pad(ms(row.p50), 12)}${pad(ms(row.p99), 12)}${pad(ms(row.max), 12)}${row.note}`,
  );
}

const localStats = time(() => {
  analyzeCron(LOCAL_CASE.source, { timezoneMode: 'browserLocal' });
});
rows.push({
  label: LOCAL_CASE.label,
  note: 'resolves the zone and probes 12 monthly offsets',
  ...localStats,
});
console.log(
  `  ${pad(LOCAL_CASE.label, 26)}${pad(ms(localStats.p50), 12)}${pad(ms(localStats.p99), 12)}${pad(ms(localStats.max), 12)}resolves the zone and probes 12 monthly offsets`,
);

/* The stages, on the typical expression, so a regression can be located. */
const TYPICAL = '*/15 9-17 * * 1-5';
const stages: [string, () => void][] = [
  ['tokenize', () => void tokenize(TYPICAL)],
  ['parse', () => void parseCron(TYPICAL)],
  ['analyze (parse + explain)', () => void analyzeCron(TYPICAL, { timezoneMode: 'utc' })],
];

console.log(`\nStages of "${TYPICAL}"\n`);
for (const [label, run] of stages) {
  const stats = time(run);
  console.log(`  ${pad(label, 26)}${pad(ms(stats.p50), 12)}${ms(stats.p99)}`);
}

const worst = rows.reduce((slowest, row) => (row.p99 > slowest.p99 ? row : slowest));
console.log(
  `\nSlowest p99: ${worst.label} at ${ms(worst.p99)} (one frame is ${String(FRAME_MS)} ms)`,
);
if (worst.p99 >= FRAME_MS) {
  console.log('  OVER BUDGET — a keystroke would drop a frame.');
  process.exitCode = 1;
} else {
  console.log(`  ${(FRAME_MS / worst.p99).toFixed(0)}x under a frame.`);
}
console.log('');
