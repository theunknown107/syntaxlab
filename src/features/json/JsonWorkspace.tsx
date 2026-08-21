import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIMITS } from '@/domain/shared/limits';
import type { JsonAnalysis } from '@/domain/json/ast';
import type { IndentStyle } from '@/domain/json/format';
import {
  analyzeJsonNow,
  clearJson,
  minifyJsonInput,
  prettifyJson,
  setJsonIndent,
  setJsonInput,
} from '@/application/json/jsonWorkspace';
import { copyToClipboard } from '@/application/clipboard';
import { workspaceStore, type WorkspaceFailure } from '@/application/stores/workspaceStore';
import { useStore } from '@/components/hooks/useStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CodeEditor, type EditorRange, type EditorSelection } from '@/components/editor/CodeEditor';
import { Button } from '@/components/primitives/Button';
import { Splitter } from '@/components/primitives/Splitter';
import { CopyButton } from '@/components/primitives/CopyButton';
import { Panel } from '@/components/primitives/Panel';
import {
  JsonErrors,
  JsonFindings,
  JsonManualPrompt,
  JsonSearch,
  JsonSelected,
  JsonToolbar,
} from './JsonPanels';
import { JsonTree } from './JsonTree';
import {
  allExpandableKeys,
  ancestorKeys,
  buildRows,
  keysToDepth,
  searchTree,
  statusLine,
  type JsonMatch,
  type JsonRow,
  type JsonStatusLine,
} from './viewModel';
import styles from './json.module.css';

/**
 * The JSON workspace — 08_UI_UX_SPEC.md §7.2
 *
 * Composition and wiring. Every asynchronous step lives in the application
 * layer and every derivation in `viewModel.ts`, so what is left here is which
 * panel goes where and which node is selected.
 *
 * The rule worth restating: **nothing here parses.** The tree, the errors, the
 * findings and the search all read a `JsonAnalysis` that the worker produced
 * and the boundary validated.
 *
 * The two columns are separate components inside separate error boundaries,
 * for the reason the regex workspace has the same shape: a rendering crash in
 * the tree must not cost the user their document.
 */

/** Containers expanded on a fresh analysis. Deep enough to orient, not to flood. */
const DEFAULT_EXPAND_DEPTH = 2;

export function JsonWorkspace(): React.JSX.Element {
  const input = useStore(workspaceStore, (state) => state.jsonInput);
  const analysis = useStore(workspaceStore, (state) => state.jsonAnalysis);
  const status = useStore(workspaceStore, (state) => state.jsonStatus);
  const failure = useStore(workspaceStore, (state) => state.jsonError);
  const manual = useStore(workspaceStore, (state) => state.jsonManual);
  const stale = useStore(workspaceStore, (state) => state.jsonStale);
  const indent = useStore(workspaceStore, (state) => state.jsonIndent);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<JsonRow | null>(null);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const nonce = useRef(0);

  const cst = analysis?.cst ?? null;

  // A new document gets a fresh, shallow expansion. Carrying the old key set
  // over would leave the tree expanded at paths that no longer exist.
  useEffect(() => {
    setExpanded(keysToDepth(cst, DEFAULT_EXPAND_DEPTH));
    setSelected(null);
  }, [cst]);

  const matches = useMemo(() => searchTree(cst, query), [cst, query]);
  const matchedKeys = useMemo(() => new Set(matches.map((match) => match.key)), [matches]);

  const rows = useMemo(
    () => buildRows(cst, expanded, analysis?.duplicateKeys ?? [], analysis?.unsafeNumbers ?? []),
    [cst, expanded, analysis],
  );

  const goTo = useCallback((offset: number) => {
    nonce.current += 1;
    setSelection({ from: offset, to: offset, nonce: nonce.current });
  }, []);

  const toggle = useCallback((key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Reveals a match by expanding its ancestors, then moving the cursor. */
  const step = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      const next = (matchIndex + delta + matches.length) % matches.length;
      const match = matches[next];
      setMatchIndex(next);
      if (!match) return;
      setExpanded((previous) => new Set([...previous, ...ancestorKeys(match.path)]));
      goTo(match.span.start);
    },
    [matchIndex, matches, goTo],
  );

  // `Ctrl/⌘ + Enter` analyses now — the only way to analyse a large document.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        analyzeJsonNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const errorRanges = useMemo<EditorRange[]>(
    () =>
      (analysis?.errors ?? [])
        .filter((error) => error.span !== undefined)
        .map((error) => ({
          from: error.span?.start ?? 0,
          to: Math.max((error.span?.start ?? 0) + 1, error.span?.end ?? 0),
          className: 'json-error',
        })),
    [analysis],
  );

  return (
    <div className={styles.workspace}>
      <ErrorBoundary scope="input">
        <InputColumn
          input={input}
          analysis={analysis}
          failure={failure}
          manual={manual}
          stale={stale}
          indent={indent}
          errorRanges={errorRanges}
          selection={selection}
          statusText={statusLine(analysis)}
          onGoTo={goTo}
        />
      </ErrorBoundary>

      <Splitter label="Resize the document and structure panels" />

      <ErrorBoundary scope="analysis">
        <TreeColumn
          analysis={analysis}
          rows={rows}
          expanded={expanded}
          onToggle={toggle}
          selected={selected}
          onSelect={(row) => {
            setSelected(row);
            goTo(row.span.start);
          }}
          matches={matches}
          matchedKeys={matchedKeys}
          query={query}
          matchIndex={matchIndex}
          onQuery={(next) => {
            setQuery(next);
            setMatchIndex(0);
          }}
          onStep={step}
          onExpandAll={() => {
            setExpanded(allExpandableKeys(cst));
          }}
          onCollapseAll={() => {
            setExpanded(new Set());
          }}
          analyzing={status === 'analyzing'}
          onGoTo={goTo}
        />
      </ErrorBoundary>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Input column
 * ------------------------------------------------------------------ */

interface InputColumnProps {
  readonly input: string;
  readonly analysis: JsonAnalysis | null;
  readonly failure: WorkspaceFailure | null;
  readonly manual: boolean;
  readonly stale: boolean;
  readonly indent: IndentStyle;
  readonly errorRanges: readonly EditorRange[];
  readonly selection: EditorSelection | null;
  readonly statusText: JsonStatusLine | null;
  readonly onGoTo: (offset: number) => void;
}

function InputColumn({
  input,
  analysis,
  failure,
  manual,
  stale,
  indent,
  errorRanges,
  selection,
  statusText,
  onGoTo,
}: InputColumnProps): React.JSX.Element {
  return (
    <div className={styles.column}>
      <Panel
        title="JSON"
        meta={`${input.length.toLocaleString('en')} characters`}
        actions={
          <>
            <CopyButton getText={() => input} label="Copy" />
            <Button onClick={clearJson} variant="ghost">
              Clear
            </Button>
          </>
        }
      >
        <CodeEditor
          value={input}
          onChange={setJsonInput}
          ariaLabel="JSON document"
          ariaDescribedBy="json-help"
          maxLength={LIMITS.json.input}
          placeholder={'{\n  "hello": "world"\n}'}
          ranges={errorRanges}
          selection={selection}
          showLineNumbers
          minHeight="14rem"
        />

        <p id="json-help" className={styles.help}>
          Parsed as strict JSON (RFC 8259) in a background thread. Nothing is uploaded.
        </p>

        <JsonToolbar
          indent={indent}
          onIndent={setJsonIndent}
          onPrettify={prettifyJson}
          onMinify={minifyJsonInput}
          canFormat={analysis?.valid === true}
          reason={
            input === '' ? 'Paste some JSON to format it.' : 'Formatting needs a valid document.'
          }
        />

        {manual && (
          <JsonManualPrompt size={input.length} stale={stale} onAnalyze={analyzeJsonNow} />
        )}
      </Panel>

      {statusText !== null && (
        <p className={statusText.valid ? styles.statusValid : styles.statusInvalid} role="status">
          {statusText.text}
        </p>
      )}

      {failure !== null && (
        <Panel title="Could not analyse">
          <div role="alert">
            <p>{failure.message}</p>
            {failure.hint !== undefined && <p className={styles.muted}>{failure.hint}</p>}
          </div>
        </Panel>
      )}

      {analysis !== null && analysis.errors.length > 0 && (
        <Panel title="Problems" meta={`${analysis.errors.length}`}>
          <JsonErrors errors={analysis.errors} source={analysis.source} onGoTo={onGoTo} />
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tree column
 * ------------------------------------------------------------------ */

interface TreeColumnProps {
  readonly analysis: JsonAnalysis | null;
  readonly rows: readonly JsonRow[];
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly selected: JsonRow | null;
  readonly onSelect: (row: JsonRow) => void;
  readonly matches: readonly JsonMatch[];
  readonly matchedKeys: ReadonlySet<string>;
  readonly query: string;
  readonly matchIndex: number;
  readonly onQuery: (query: string) => void;
  readonly onStep: (delta: number) => void;
  readonly onExpandAll: () => void;
  readonly onCollapseAll: () => void;
  readonly analyzing: boolean;
  readonly onGoTo: (offset: number) => void;
}

/**
 * Whether the Findings panel has anything to say.
 *
 * `JsonFindings` renders nothing when there is nothing to report, so the panel
 * around it has to ask the same question — otherwise a valid document gets a
 * titled, empty box between its status line and its tree. Found by the M12
 * visual pass at 390 px, where the wasted band is most obvious.
 */
function hasFindings(analysis: JsonAnalysis | null): analysis is JsonAnalysis {
  return (
    analysis !== null && (analysis.duplicateKeys.length > 0 || analysis.unsafeNumbers.length > 0)
  );
}

function TreeColumn(props: TreeColumnProps): React.JSX.Element {
  const { analysis, rows, analyzing } = props;

  return (
    <div className={styles.column}>
      {hasFindings(analysis) && (
        <Panel title="Findings">
          <JsonFindings analysis={analysis} onGoTo={props.onGoTo} />
        </Panel>
      )}

      <Panel
        title="Structure"
        meta={rows.length > 0 ? `${rows.length.toLocaleString('en')} rows` : undefined}
        actions={
          analysis?.cst != null && (
            <>
              <Button onClick={props.onExpandAll} variant="ghost">
                Expand all
              </Button>
              <Button onClick={props.onCollapseAll} variant="ghost">
                Collapse all
              </Button>
            </>
          )
        }
      >
        <JsonSearch
          query={props.query}
          onQuery={props.onQuery}
          matches={props.matches}
          index={props.matchIndex}
          onStep={props.onStep}
        />

        <JsonSelected
          row={props.selected}
          onCopy={(text) => {
            void copyToClipboard(text);
          }}
        />

        {rows.length === 0 ? (
          <p className={styles.muted}>
            {analyzing ? 'Reading the document…' : 'Your tree will appear here.'}
          </p>
        ) : (
          <JsonTree
            rows={rows}
            expandedKeys={props.expanded}
            onToggle={props.onToggle}
            onSelect={props.onSelect}
            selectedKey={props.selected?.key ?? null}
            matchedKeys={props.matchedKeys}
          />
        )}
      </Panel>
    </div>
  );
}
