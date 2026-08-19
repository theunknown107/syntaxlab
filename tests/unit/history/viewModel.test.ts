import { describe, expect, it } from 'vitest';

import type { HistoryEntry, HistoryMetadata, HistoryPage } from '@/domain/history/entry';
import {
  countLabel,
  formatBytes,
  integrityNotes,
  NOT_DURABLE_NOTE,
  relativeTime,
  STORAGE_NOTE,
  summarise,
} from '@/features/history/viewModel';

/**
 * History presentation.
 *
 * Wording is tested because wording is where this feature goes wrong: "1
 * entries", a privacy promise the architecture cannot keep, or a silent count
 * of data the user cannot see.
 */

function entry(metadata: HistoryMetadata): HistoryEntry {
  return {
    id: 'e1',
    schemaVersion: 1,
    type: metadata.type,
    title: 't',
    isCustomTitle: false,
    input: 'i',
    inputTruncated: false,
    metadata,
    createdAt: 1,
    lastOpenedAt: 1,
    openCount: 1,
    pinned: false,
    tags: [],
    searchText: 't',
  };
}

function page(over: Partial<HistoryPage>): HistoryPage {
  return { entries: [], total: 0, fromNewerVersion: 0, quarantined: 0, ...over };
}

describe('summarise', () => {
  it('describes a regex entry', () => {
    const summary = summarise(
      entry({ type: 'regex', flags: 'gi', groupCount: 2, hadErrors: false, nodeCount: 5 }),
    );
    expect(summary.typeLabel).toBe('Regex');
    expect(summary.detail).toBe('flags gi · 2 groups');
  });

  it('singularises one group', () => {
    const summary = summarise(
      entry({ type: 'regex', flags: '', groupCount: 1, hadErrors: false, nodeCount: 1 }),
    );
    expect(summary.detail).toBe('no flags · 1 group');
  });

  it('says when a pattern had errors, rather than hiding it', () => {
    const summary = summarise(
      entry({ type: 'regex', flags: 'g', groupCount: 0, hadErrors: true, nodeCount: 1 }),
    );
    expect(summary.detail).toContain('had errors');
  });

  it('describes a json entry', () => {
    const summary = summarise(
      entry({ type: 'json', valid: true, nodeCount: 42, maxDepth: 3, byteLength: 1_500 }),
    );
    expect(summary.typeLabel).toBe('JSON');
    expect(summary.detail).toBe('42 values · depth 3 · 1.5 kB');
  });

  it('singularises one value', () => {
    const summary = summarise(
      entry({ type: 'json', valid: true, nodeCount: 1, maxDepth: 0, byteLength: 4 }),
    );
    expect(summary.detail).toContain('1 value ·');
  });
});

describe('formatBytes', () => {
  it('scales its unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1_500)).toBe('1.5 kB');
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
  });
});

describe('relativeTime', () => {
  const now = 1_700_000_000_000;

  it('is coarse, because minute-accuracy is noise in a list', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now - 30_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(relativeTime(now - 3_600_000, now)).toBe('1 hour ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
    expect(relativeTime(now - 86_400_000, now)).toBe('1 day ago');
  });

  it('falls back to a date once relative time stops helping', () => {
    expect(relativeTime(now - 200 * 86_400_000, now)).toMatch(/\d{4}/);
  });

  it('never reports a negative age from a clock that moved backwards', () => {
    expect(relativeTime(now + 60_000, now)).toBe('just now');
  });
});

describe('countLabel', () => {
  it('distinguishes an empty list from an empty search', () => {
    expect(countLabel(page({}), false)).toBe('Nothing saved yet');
    expect(countLabel(page({}), true)).toBe('No matches');
  });

  it('singularises one entry', () => {
    expect(countLabel(page({ total: 1, entries: [entry({ type: 'regex', flags: '', groupCount: 0, hadErrors: false, nodeCount: 0 })] }), false)).toBe(
      '1 entry',
    );
  });

  it('says how many of how many when the page is capped', () => {
    const shown = Array.from({ length: 3 }, () =>
      entry({ type: 'regex', flags: '', groupCount: 0, hadErrors: false, nodeCount: 0 }),
    );
    expect(countLabel(page({ total: 1_200, entries: shown }), false)).toBe('3 of 1,200 entries');
  });
});

describe('integrityNotes', () => {
  it('says nothing when there is nothing to say', () => {
    expect(integrityNotes(page({}))).toEqual([]);
  });

  it('reports entries from a newer version as kept, not lost', () => {
    const [note] = integrityNotes(page({ fromNewerVersion: 1 }));
    expect(note).toContain('1 entry was');
    expect(note).toContain('kept');
  });

  it('reports quarantined entries as set aside, not deleted', () => {
    const [note] = integrityNotes(page({ quarantined: 2 }));
    expect(note).toContain('2 entries');
    expect(note).toContain('set aside rather than deleted');
  });

  it('reports both at once', () => {
    expect(integrityNotes(page({ fromNewerVersion: 1, quarantined: 1 }))).toHaveLength(2);
  });
});

describe('privacy wording', () => {
  /**
   * These assertions exist because the failure they guard against is not a
   * crash: it is a sentence promising something the architecture cannot
   * enforce. A browser profile can sync, and a shared device has other users.
   */
  it('never claims the data cannot leave the device', () => {
    for (const text of [STORAGE_NOTE, NOT_DURABLE_NOTE]) {
      expect(text).not.toMatch(/never leave|cannot leave|100% private|completely private/i);
      expect(text).not.toMatch(/\bsecure\b|\bencrypted\b/i);
    }
  });

  it('says what is true: local storage, no server, readable by others here', () => {
    expect(STORAGE_NOTE).toContain('stored in this browser');
    expect(STORAGE_NOTE).toContain('not sent to any server');
    expect(STORAGE_NOTE).toContain('Anyone with access to this browser profile');
  });

  it('tells the user plainly when nothing is being saved', () => {
    expect(NOT_DURABLE_NOTE).toContain('lost when the tab closes');
    expect(NOT_DURABLE_NOTE).toContain('Analysis is unaffected');
  });
});
