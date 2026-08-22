/**
 * Input and complexity limits — 03_DOMAIN_MODEL.md §2.5, 05_SECURITY.md §6
 *
 * Defined once here and imported by the editor, the application layer, and the
 * worker, so all three enforce identical numbers. A limit checked in only one
 * place is a limit a refactor will eventually bypass; the worker layer is the
 * one that matters, because the worker never trusts its caller.
 */

export const LIMITS = {
  regex: {
    /** Far beyond any real pattern; keeps parse time trivially bounded. */
    pattern: 10_000,
    /** Large enough for real log samples, small enough that scans stay fast. */
    testSubject: 1_000_000,
    /**
     * Wall-clock budget for RegExp execution, enforced by terminating the
     * worker. JavaScript regex execution cannot be interrupted any other way.
     */
    execMs: 2_000,
    /** Rendering more is pointless; the UI states that results were truncated. */
    maxMatches: 10_000,
    /**
     * Per-value clip for matched and captured text. A pattern such as `.*`
     * against a 1 MB subject matches quickly and legitimately, and without a
     * clip the result would carry the whole subject back across the worker
     * boundary once per match. The true length travels alongside the clipped
     * value, so the UI reports the real size rather than the shown one.
     */
    maxMatchTextChars: 2_000,
    /**
     * Ceiling on the total text a single execution may return. `maxMatches`
     * alone does not bound memory: 10 000 matches of 2 000 characters each
     * would be 20 MB. Reaching this stops the scan and is reported as a
     * truncation, never silently.
     */
    maxOutputChars: 2_000_000,
    /** Nested-group depth before we refuse rather than risk a stack overflow. */
    maxDepth: 100,
  },
  json: {
    /** Covers realistic API payloads. */
    input: 5_000_000,
    /** Real JSON is under ~20 deep. Prevents pathological nesting. */
    maxDepth: 500,
    /** Memory ceiling for the tree. */
    maxNodes: 500_000,
  },
  cron: {
    /**
     * A cron expression is five short fields. Anything approaching this is
     * either not a cron expression or an attempt to find a limit.
     */
    input: 1_000,
    /** The dialect lock, as a number the parser compares against. */
    fields: 5,
    /**
     * Ceiling on tokens from one expression. `input` already bounds this, but
     * the parser states its own budget rather than inheriting one.
     */
    maxTokens: 2_000,
    /** Terms in a single field, i.e. commas + 1. Guards a pathological list. */
    maxTermsPerField: 200,
    /**
     * How far ahead a schedule search looks — M16.
     *
     * Five years covers every schedule this dialect can express: the sparsest
     * possible is a single minute on a single day of a single month, which
     * recurs annually, and 29 February needs four. The extra year is slack for
     * the 100/400 leap rules, so `0 0 29 2 *` starting in 2096 still finds
     * 2104 rather than reporting a schedule that does run as one that never
     * does.
     */
    searchYears: 5,
    /**
     * Iterations one search may take before giving up.
     *
     * The field-advance algorithm needs tens, not thousands — this is not a
     * budget, it is a tripwire. If it ever fires, the advance logic has a bug
     * that would otherwise present as a frozen worker.
     */
    maxSearchSteps: 100_000,
    /**
     * Occurrences the UI may ask for at once.
     *
     * A preview, not a scheduler simulation (21_ACCEPTANCE_CRITERIA.md C-3).
     */
    maxOccurrences: 10,
  },
  history: {
    maxEntries: 500,
    maxInputChars: 100_000,
    softQuotaBytes: 50_000_000,
    /** Identical (type, input) inside this window updates rather than duplicates. */
    dedupeWindowMs: 60_000,
  },
  importFile: {
    bytes: 20_000_000,
    entries: 10_000,
  },
} as const;

/** Size thresholds that switch the UI between automatic and manual analysis. */
export const ANALYSIS_THRESHOLDS = {
  /** Above this, analysis requires an explicit action rather than a debounce. */
  manualAnalyzeBytes: 500_000,
  debounce: {
    smallMs: 150,
    mediumMs: 300,
    largeMs: 600,
  },
  smallBytes: 1_000,
  mediumBytes: 50_000,
} as const;

export type LimitName = keyof typeof LIMITS;

/**
 * Chooses a debounce delay from input size. A fixed value is wrong at both
 * ends of the range: too slow for a short pattern, too eager for a large
 * document (12_PERFORMANCE.md §3.2).
 */
export function debounceForSize(length: number): number {
  if (length < ANALYSIS_THRESHOLDS.smallBytes) return ANALYSIS_THRESHOLDS.debounce.smallMs;
  if (length < ANALYSIS_THRESHOLDS.mediumBytes) return ANALYSIS_THRESHOLDS.debounce.mediumMs;
  return ANALYSIS_THRESHOLDS.debounce.largeMs;
}

export function requiresManualAnalysis(length: number): boolean {
  return length >= ANALYSIS_THRESHOLDS.manualAnalyzeBytes;
}
