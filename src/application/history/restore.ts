import type { HistoryEntry } from '@/domain/history/entry';

import { setJsonInput } from '../json/jsonWorkspace';
import { setPattern } from '../regex/regexWorkspace';
import { setMode } from '../stores/workspaceStore';
import { markCaptured } from './capture';
import { touchEntry } from './historyStore';

/**
 * Loading an entry back into the workspace — 08_UI_UX_SPEC.md §19.4
 *
 * Separate from `capture.ts` so the dependency runs one way: the workspaces
 * tell capture that an analysis finished, and restore tells the workspaces what
 * to show. Putting both in one module would make the pair circular.
 *
 * Analyses are not stored, so restoring recomputes one. That is not a
 * compromise — it means a restored entry is explained by the build the user is
 * running now, rather than by whatever produced it months ago.
 */
export function restoreEntry(entry: HistoryEntry): void {
  // The text about to appear in the editor came *from* history, so the
  // analysis it triggers must not write it straight back as a new entry.
  markCaptured(entry.type, entry.input);

  // The mode switches to match: restoring a JSON document into the regex pane
  // would be worse than not restoring at all.
  setMode(entry.type);

  if (entry.type === 'regex') {
    setPattern(entry.input);
  } else {
    setJsonInput(entry.input);
  }

  // Recorded as used, which is what the "recently opened" sort is built on.
  void touchEntry(entry);
}
