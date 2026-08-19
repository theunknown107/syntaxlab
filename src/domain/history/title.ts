import { LIMITS } from '../shared/limits';
import type { HistoryMetadata, HistoryType, NewHistoryEntry } from './entry';

/**
 * Title derivation — 03_DOMAIN_MODEL.md §6.3
 *
 * Deterministic and pure, so it is unit-testable and so two tabs analysing the
 * same input produce the same title. The title is what the user scans a list
 * of fifty entries by, so it has to say what the entry *is* rather than repeat
 * the first sixty characters of the input.
 */

const TITLE_LIMIT = 60;

function clip(value: string, limit = TITLE_LIMIT): string {
  // Newlines are stripped as well as length: a title is one line in a list,
  // and a pasted multi-line document would otherwise break the row.
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

export function deriveTitle(type: HistoryType, input: string, metadata: HistoryMetadata): string {
  const title = type === 'regex' ? regexTitle(input, metadata) : jsonTitle(metadata);
  return title === '' ? `Untitled ${type}` : title;
}

function regexTitle(input: string, metadata: HistoryMetadata): string {
  if (metadata.type !== 'regex') return '';
  // The literal form, because that is how a developer recognises a pattern.
  return clip(`/${input}/${metadata.flags}`);
}

function jsonTitle(metadata: HistoryMetadata): string {
  if (metadata.type !== 'json') return '';
  if (!metadata.valid) return 'Invalid JSON';

  const size = `${metadata.nodeCount.toLocaleString('en')} ${metadata.nodeCount === 1 ? 'value' : 'values'}`;
  return `JSON · ${size} · depth ${metadata.maxDepth}`;
}

/**
 * Truncates an input for storage, reporting whether it had to.
 *
 * Over-limit inputs are stored truncated *and flagged*, so restore can say the
 * entry is partial rather than handing back a silently shortened document
 * (H-I4).
 */
export function truncateInput(input: string): { input: string; truncated: boolean } {
  const max = LIMITS.history.maxInputChars;
  return input.length <= max
    ? { input, truncated: false }
    : { input: input.slice(0, max), truncated: true };
}

/** Everything a caller needs to persist one analysis, derived in one place. */
export function newEntry(
  type: HistoryType,
  rawInput: string,
  metadata: HistoryMetadata,
): NewHistoryEntry {
  const { input } = truncateInput(rawInput);
  return { type, title: deriveTitle(type, input, metadata), input: rawInput, metadata };
}
