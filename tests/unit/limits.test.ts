import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_THRESHOLDS,
  debounceForSize,
  LIMITS,
  requiresManualAnalysis,
} from '@/domain/shared/limits';

describe('LIMITS', () => {
  it('matches the documented values in 03_DOMAIN_MODEL.md §2.5', () => {
    // These numbers are referenced by the editor, the application layer, and
    // the worker. A silent change here would desynchronise all three.
    expect(LIMITS.regex.pattern).toBe(10_000);
    expect(LIMITS.regex.testSubject).toBe(1_000_000);
    expect(LIMITS.regex.execMs).toBe(2_000);
    expect(LIMITS.regex.maxMatches).toBe(10_000);
    expect(LIMITS.json.input).toBe(5_000_000);
    expect(LIMITS.json.maxDepth).toBe(500);
    expect(LIMITS.json.maxNodes).toBe(500_000);
    expect(LIMITS.history.maxEntries).toBe(500);
  });
});

describe('debounceForSize', () => {
  it('uses the shortest delay for small input', () => {
    expect(debounceForSize(0)).toBe(ANALYSIS_THRESHOLDS.debounce.smallMs);
    expect(debounceForSize(999)).toBe(ANALYSIS_THRESHOLDS.debounce.smallMs);
  });

  it('steps up at the small/medium boundary', () => {
    expect(debounceForSize(1_000)).toBe(ANALYSIS_THRESHOLDS.debounce.mediumMs);
  });

  it('steps up at the medium/large boundary', () => {
    expect(debounceForSize(50_000)).toBe(ANALYSIS_THRESHOLDS.debounce.largeMs);
  });

  it('is monotonic across the size range', () => {
    const sizes = [0, 500, 1_000, 10_000, 50_000, 400_000];
    const delays = sizes.map(debounceForSize);
    const sorted = [...delays].sort((a, b) => a - b);
    expect(delays).toEqual(sorted);
  });
});

describe('requiresManualAnalysis', () => {
  it('allows automatic analysis below the threshold', () => {
    expect(requiresManualAnalysis(499_999)).toBe(false);
  });

  it('requires an explicit action at and above the threshold', () => {
    // Above this size, auto-analysis wastes work on every keystroke of a
    // paste-and-edit cycle (12_PERFORMANCE.md §3.2).
    expect(requiresManualAnalysis(500_000)).toBe(true);
    expect(requiresManualAnalysis(5_000_000)).toBe(true);
  });
});
