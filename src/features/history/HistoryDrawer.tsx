import { useEffect, useId, useRef, useState } from 'react';

import {
  clearAll,
  dismissUndo,
  historyStore,
  refresh,
  remove,
  rename,
  setPinned,
  setPinnedOnly,
  resumeCapture,
  setSearch,
  setSort,
  setTypeFilter,
  undoRemove,
  type HistoryState,
} from '@/application/history/historyStore';
import { restoreEntry } from '@/application/history/restore';
import { settingsStore } from '@/application/stores/settingsStore';
import { useStore } from '@/components/hooks/useStore';
import { Badge } from '@/components/primitives/Button';
import { ConfirmDialog, Drawer } from '@/components/primitives/Dialog';
import type { HistoryEntry, StorageError } from '@/domain/history/entry';

import { HistoryTransfer } from './HistoryTransfer';
import {
  countLabel,
  errorNote,
  integrityNotes,
  NOT_DURABLE_NOTE,
  relativeTime,
  STORAGE_NOTE,
  summarise,
} from './viewModel';
import styles from './history.module.css';

/**
 * The history drawer — 08_UI_UX_SPEC.md §19
 *
 * Everything the user can do with saved work: find it, open it, keep it,
 * rename it, delete it. No IndexedDB code appears here; every action is one
 * call into the application layer.
 *
 * **Nothing in an entry is rendered as HTML.** Titles and inputs are user text
 * that has been to disk and back, and they appear only as React children,
 * which escapes them. There is no `dangerouslySetInnerHTML` in this feature.
 */

export interface HistoryDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function HistoryDrawer({ open, onClose }: HistoryDrawerProps): React.JSX.Element {
  const state = useStore(historyStore, (value) => value);
  const sort = useStore(settingsStore, (value) => value.historySort);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const searchId = useId();

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const filtered = state.search !== '' || state.typeFilter !== null || state.pinnedOnly;

  return (
    <Drawer open={open} onClose={onClose} title="History">
      <div className={styles.drawer}>
        <header className={styles.header}>
          <h2 className={styles.title}>History</h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </header>

        <div className={styles.controls}>
          <label className="srOnly" htmlFor={searchId}>
            Search history
          </label>
          <input
            id={searchId}
            type="search"
            className={styles.search}
            placeholder="Search titles and inputs"
            value={state.search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />

          <div className={styles.filters}>
            <FilterButton
              label="All"
              active={state.typeFilter === null && !state.pinnedOnly}
              onClick={() => {
                setTypeFilter(null);
                setPinnedOnly(false);
              }}
            />
            <FilterButton
              label="Regex"
              active={state.typeFilter === 'regex'}
              onClick={() => {
                setTypeFilter(state.typeFilter === 'regex' ? null : 'regex');
              }}
            />
            <FilterButton
              label="JSON"
              active={state.typeFilter === 'json'}
              onClick={() => {
                setTypeFilter(state.typeFilter === 'json' ? null : 'json');
              }}
            />
            <FilterButton
              label="Pinned"
              active={state.pinnedOnly}
              onClick={() => {
                setPinnedOnly(!state.pinnedOnly);
              }}
            />

            <label className={styles.sort}>
              <span className="srOnly">Sort history by</span>
              <select
                className={styles.select}
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value === 'opened' ? 'opened' : 'created');
                }}
              >
                <option value="created">Newest first</option>
                <option value="opened">Recently opened</option>
              </select>
            </label>
          </div>
        </div>

        <p className={styles.count} aria-live="polite">
          {countLabel(state.page, filtered)}
        </p>

        <Notices state={state} />

        <ul className={styles.list}>
          {state.page.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onOpen={onClose} />
          ))}
        </ul>

        {state.page.total === 0 && !filtered ? (
          <p className={styles.empty}>
            Analyses you work on are saved here automatically, a couple of seconds after they
            settle. Nothing is saved while history is paused.
          </p>
        ) : null}

        <footer className={styles.footer}>
          <p className={styles.privacy}>{STORAGE_NOTE}</p>
          <div className={styles.footerActions}>
            <HistoryTransfer />
            <button
              type="button"
              className={styles.dangerLink}
              onClick={() => {
                setConfirmingClear(true);
              }}
              disabled={state.page.total === 0}
            >
              Clear all
            </button>
          </div>
        </footer>

        {state.pendingUndo !== null ? <UndoBar title={state.pendingUndo.title} /> : null}
      </div>

      <ConfirmDialog
        open={confirmingClear}
        onClose={() => {
          setConfirmingClear(false);
        }}
        onConfirm={() => {
          void clearAll();
        }}
        title="Delete all history?"
        confirmLabel="Delete everything"
        destructive
      >
        This removes every saved entry from this browser, including pinned ones. It cannot be
        undone. Export first if you want to keep a copy.
      </ConfirmDialog>
    </Drawer>
  );
}

/** Everything the drawer has to say about the state of storage itself. */
function Notices({ state }: { readonly state: HistoryState }): React.JSX.Element {
  return (
    <>
      {!state.durable && state.status !== 'idle' ? (
        <p className={styles.warning} role="status">
          {NOT_DURABLE_NOTE}
        </p>
      ) : null}

      {state.captureSuspended ? (
        <div className={styles.warning} role="status">
          <p className={styles.errorTitle}>
            Storage filled up, so new analyses are no longer being saved.
          </p>
          <p className={styles.errorHint}>
            Delete or export some entries, then resume. Nothing already saved was removed.
          </p>
          <button type="button" className={styles.linkAction} onClick={resumeCapture}>
            Resume saving
          </button>
        </div>
      ) : null}

      {state.error !== null ? <ErrorNote error={state.error} /> : null}

      {integrityNotes(state.page).map((note) => (
        <p key={note} className={styles.note}>
          {note}
        </p>
      ))}
    </>
  );
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`${styles.filter} ${active ? styles.filterActive : ''}`}
      // Pressed state, not just a colour: a filter that is on must be
      // announced as on (08_UI_UX_SPEC.md §12.1).
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ErrorNote({ error }: { readonly error: StorageError }): React.JSX.Element {
  const note = errorNote(error);
  return (
    <div className={styles.error} role="alert">
      <p className={styles.errorTitle}>{note.title}</p>
      {note.hint !== null ? <p className={styles.errorHint}>{note.hint}</p> : null}
    </div>
  );
}

function EntryRow({
  entry,
  onOpen,
}: {
  readonly entry: HistoryEntry;
  readonly onOpen: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const summary = summarise(entry);

  return (
    <li className={styles.row}>
      {editing ? (
        <RenameForm
          entry={entry}
          onDone={() => {
            setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.open}
          // Labelled explicitly: without this the accessible name is the whole
          // row — title, badge, counts and timestamp run together — which is a
          // sentence to listen to before knowing what the button does.
          aria-label={`Open ${entry.title}`}
          onClick={() => {
            restoreEntry(entry);
            onOpen();
          }}
        >
          {/* User text, rendered as a text child. React escapes it; nothing
              here builds markup from a stored string. */}
          <span className={styles.rowTitle}>{entry.title}</span>
          <span className={styles.rowMeta}>
            <Badge tone={entry.type === 'regex' ? 'accent' : 'info'}>{summary.typeLabel}</Badge>
            <span>{summary.detail}</span>
            <span>{relativeTime(entry.lastOpenedAt)}</span>
          </span>
          {entry.inputTruncated ? (
            <span className={styles.truncated}>
              Saved shortened — the original was longer than the storage limit.
            </span>
          ) : null}
        </button>
      )}

      <div className={styles.rowActions}>
        <IconButton
          label={entry.pinned ? `Unpin ${entry.title}` : `Pin ${entry.title}`}
          pressed={entry.pinned}
          onClick={() => {
            void setPinned(entry.id, !entry.pinned);
          }}
        >
          {entry.pinned ? 'Pinned' : 'Pin'}
        </IconButton>
        <IconButton
          label={`Rename ${entry.title}`}
          onClick={() => {
            setEditing(true);
          }}
        >
          Rename
        </IconButton>
        <IconButton
          label={`Delete ${entry.title}`}
          onClick={() => {
            void remove(entry.id);
          }}
        >
          Delete
        </IconButton>
      </div>
    </li>
  );
}

function IconButton({
  label,
  children,
  onClick,
  pressed,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly pressed?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.rowAction}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RenameForm({
  entry,
  onDone,
}: {
  readonly entry: HistoryEntry;
  readonly onDone: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(entry.title);
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);

  // Focus is moved here rather than declared with `autoFocus`: this input has
  // replaced the button the user just activated, so without this, focus would
  // be left on a node that no longer exists.
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  return (
    <form
      className={styles.rename}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() !== '') void rename(entry.id, value);
        onDone();
      }}
    >
      <label className="srOnly" htmlFor={fieldId}>
        New name for this entry
      </label>
      <input
        ref={field}
        id={fieldId}
        className={styles.renameField}
        value={value}
        maxLength={120}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onKeyDown={(event) => {
          // Escape cancels the rename without closing the drawer around it.
          if (event.key === 'Escape') {
            event.stopPropagation();
            onDone();
          }
        }}
      />
      <button type="submit" className={styles.rowAction}>
        Save
      </button>
      <button type="button" className={styles.rowAction} onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

function UndoBar({ title }: { readonly title: string }): React.JSX.Element {
  return (
    <div className={styles.undo} role="status">
      <span className={styles.undoText}>Deleted “{title}”</span>
      <button
        type="button"
        className={styles.undoAction}
        onClick={() => {
          void undoRemove();
        }}
      >
        Undo
      </button>
      <button type="button" className={styles.rowAction} onClick={dismissUndo}>
        Dismiss
      </button>
    </div>
  );
}
