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
