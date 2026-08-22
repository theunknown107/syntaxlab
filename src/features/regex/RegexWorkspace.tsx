import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RegexAnalysis } from '@/domain/regex/ast';
import { LIMITS } from '@/domain/shared/limits';
import { explanationToText } from '@/domain/shared/explanation';
import type { SourceSpan } from '@/domain/shared/result';
import {
  analyzeNow,
  clearTestSubject,
  runMatchesNow,
  clearWorkspace,
  loadExample,
  resetFlags,
  setPattern,
  setTestSubject,
  toggleFlag,
} from '@/application/regex/regexWorkspace';
import {
  regexSubmission,
  workspaceStore,
  type AnalysisStatus,
  type WorkspaceFailure,
} from '@/application/stores/workspaceStore';
import { useStore } from '@/components/hooks/useStore';
import { AnalyzeAction, AnalyzeStatus } from '@/components/primitives/AnalyzeAction';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CodeEditor, type EditorSelection } from '@/components/editor/CodeEditor';
import { Button } from '@/components/primitives/Button';
import { CopyButton } from '@/components/primitives/CopyButton';
import { Panel } from '@/components/primitives/Panel';
import { Splitter } from '@/components/primitives/Splitter';
import { TreeView } from '@/components/tree/TreeView';
import { EXAMPLES } from './examples';
import { ExplanationView, type SpanLinkHandlers } from '@/components/ExplanationView';
import { FlagBar } from './FlagBar';
import { MatchResults } from './MatchResults';
import { CompatibilityView, GroupTable, TokenTable, WarningList } from './RegexPanels';
import { astToTree, expandableKeys, linkedRange, matchRanges, tokenRanges } from './viewModel';
import type { AstRow } from './viewModel';
import styles from './regex.module.css';

/**
 * The regex workspace — 08_UI_UX_SPEC.md §7.1
 *
 * Composition and wiring only. Every asynchronous step lives in the
 * application layer and every derivation lives in `viewModel.ts`, so what is
 * left here is which panel goes where and which span is currently linked.
 *
 * `hoveredSpan` is deliberately local state rather than a store value: nothing
 * outside this feature needs it, and putting a hover at pointer frequency into
 * a shared store would notify subscribers that do not care
 * (11_STATE_MANAGEMENT.md §2).
 */
export function RegexWorkspace(): React.JSX.Element {
  const pattern = useStore(workspaceStore, (state) => state.pattern);
  const flags = useStore(workspaceStore, (state) => state.flags);
  const testSubject = useStore(workspaceStore, (state) => state.testSubject);
  const analysis = useStore(workspaceStore, (state) => state.analysis);
  const analysisStatus = useStore(workspaceStore, (state) => state.analysisStatus);
  const analysisError = useStore(workspaceStore, (state) => state.analysisError);
  const exec = useStore(workspaceStore, (state) => state.exec);
  const execStatus = useStore(workspaceStore, (state) => state.execStatus);
  const execError = useStore(workspaceStore, (state) => state.execError);
  const committedPattern = useStore(workspaceStore, (state) => state.committedPattern);
  const committedFlags = useStore(workspaceStore, (state) => state.committedFlags);

  // Derived, not stored: a `stale` flag kept beside the strings it summarises
  // is a third thing that can disagree with them.
  const submission = regexSubmission(pattern, flags, committedPattern, committedFlags);

  const [hoveredSpan, setHoveredSpan] = useState<SourceSpan | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(['0']));
  const nonce = useRef(0);

  const links: SpanLinkHandlers = useMemo(
    () => ({
      onHover: setHoveredSpan,
      onSelect: (span) => {
        nonce.current += 1;
        setSelection({ from: span.start, to: span.end, nonce: nonce.current });
      },
    }),
    [],
  );

  // `Ctrl/⌘ + Enter` analyses immediately from anywhere in the workspace, and
  // `Ctrl/⌘ + Shift + K` clears. Both have visible equivalents below; a
  // shortcut without one is unreachable for anyone who cannot use it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        analyzeNow();
      } else if (event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        clearWorkspace();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const patternRanges = useMemo(
    () => [...(analysis ? tokenRanges(analysis.tokens) : []), ...linkedRange(hoveredSpan)],
    [analysis, hoveredSpan],
  );

  const subjectRanges = useMemo(() => (exec ? matchRanges(exec.matches) : []), [exec]);

  const tree = useMemo(() => (analysis ? [astToTree(analysis.ast)] : []), [analysis]);

  const toggleNode = useCallback((key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const patternIsValid = analysis !== null && analysis.errors.length === 0;
  const overLimit = pattern.length > LIMITS.regex.pattern * 0.8;

  return (
    <div className={styles.workspace}>
      {/* Two boundaries rather than one, because the thing that must survive a
          rendering crash is the user's input — it is the only state in this
          app that cannot be recomputed (10_COMPONENT_ARCHITECTURE.md §2). */}
      <ErrorBoundary scope="input">
        <div className={styles.column}>
          <Panel
            title="Pattern"
            actions={
              <>
                <span className={styles.flavour} title="The tester runs this browser's own engine.">
                  ECMAScript (JavaScript)
                </span>
                <CopyButton getText={() => `/${pattern}/${flags}`} label="Copy" />
                <Button
                  onClick={() => {
                    setPattern('');
                  }}
                  variant="ghost"
                >
                  Clear
                </Button>
              </>
            }
          >
            <div className={styles.patternRow}>
              <span className={styles.delimiter} aria-hidden="true">
                /
              </span>
              <div className={styles.patternEditor}>
                <CodeEditor
                  value={pattern}
                  onChange={setPattern}
                  ariaLabel="Regular expression pattern"
                  ariaDescribedBy="pattern-help"
                  maxLength={LIMITS.regex.pattern}
                  placeholder="^[A-Z][a-z]+$"
                  ranges={patternRanges}
                  selection={selection}
                  singleLine
                />
              </div>
              <span className={styles.delimiter} aria-hidden="true">
                /{flags}
              </span>
            </div>

            <p id="pattern-help" className={styles.help}>
              Parsed as an ECMAScript regular expression. Nothing is uploaded.
            </p>

            <FlagBar flags={flags} onToggle={toggleFlag} onReset={resetFlags} />

            <div className={styles.inputFooter}>
              <span className={overLimit ? styles.countWarn : styles.count}>
                {pattern.length.toLocaleString('en')} / {LIMITS.regex.pattern.toLocaleString('en')}{' '}
                characters
              </span>
              <ExamplePicker />
            </div>

            <div className={styles.inputFooter}>
              <AnalyzeAction
                submission={submission}
                busy={analysisStatus === 'analyzing'}
                onAnalyze={analyzeNow}
                subject="pattern"
              />
            </div>
            <AnalyzeStatus
              submission={submission}
              busy={analysisStatus === 'analyzing'}
              subject="pattern"
            />
          </Panel>

          <Panel title="Test string" meta={`${testSubject.length.toLocaleString('en')} characters`}>
            <CodeEditor
              value={testSubject}
              onChange={setTestSubject}
              ariaLabel="Test string"
              maxLength={LIMITS.regex.testSubject}
              placeholder="Paste text to test the pattern against."
              ranges={subjectRanges}
              showLineNumbers
              minHeight="6rem"
            />
            <div className={styles.inputFooter}>
              <Button onClick={clearTestSubject} variant="ghost">
                Clear test string
              </Button>
              <Button onClick={runMatchesNow} variant="primary">
                Run now
              </Button>
            </div>
          </Panel>

          <Panel title="Matches">
            <MatchResults
              status={execStatus}
              result={exec}
              error={execError}
              hasPattern={pattern !== ''}
              hasSubject={testSubject !== ''}
              patternIsValid={patternIsValid}
            />
          </Panel>
        </div>
      </ErrorBoundary>

      <Splitter label="Resize the pattern and explanation panels" />

      <ErrorBoundary scope="analysis">
        <div className={styles.column}>
          <Panel
            title="Explanation"
            actions={
              analysis && (
                <CopyButton
                  getText={() => explanationToText(analysis.explanation.summary)}
                  label="Copy explanation"
                />
              )
            }
          >
            <ExplanationPanelBody
              analysis={analysis}
              status={analysisStatus}
              error={analysisError}
              links={links}
            />
          </Panel>

          {analysis && (analysis.warnings.length > 0 || analysis.errors.length > 0) && (
            <Panel title="Warnings" meta={`${analysis.warnings.length + analysis.errors.length}`}>
              <WarningList warnings={analysis.warnings} errors={analysis.errors} links={links} />
            </Panel>
          )}

          {analysis && (
            <>
              <Panel
                title="Structure"
                collapsible
                actions={
                  <Button
                    onClick={() => {
                      setExpanded(expandableKeys(astToTree(analysis.ast)));
                    }}
                    variant="ghost"
                  >
                    Expand all
                  </Button>
                }
              >
                <TreeView<AstRow>
                  roots={tree}
                  expandedKeys={expanded}
                  onToggle={toggleNode}
                  ariaLabel="Pattern structure"
                  renderNode={(row) => (
                    <span className={styles.astRow}>
                      <span className={styles.astLabel}>{row.label}</span>
                      {row.detail !== undefined && (
                        <code className={styles.code}>{row.detail}</code>
                      )}
                    </span>
                  )}
                  onSelect={(node) => {
                    links.onSelect(node.value.span);
                  }}
                />
              </Panel>

              <Panel title="Groups" meta={`${analysis.groups.length}`} collapsible>
                <GroupTable groups={analysis.groups} links={links} />
              </Panel>

              <Panel
                title="Tokens"
                meta={`${analysis.tokens.length}`}
                collapsible
                defaultOpen={false}
              >
                <TokenTable tokens={analysis.tokens} links={links} />
              </Panel>

              <Panel title="Compatibility" collapsible defaultOpen={false}>
                <CompatibilityView compatibility={analysis.compatibility} />
              </Panel>
            </>
          )}
        </div>
      </ErrorBoundary>
    </div>
  );
}

/**
 * What the explanation panel shows: the explanation, the reason there is none,
 * or the fact that one is being produced. Split out so the workspace stays a
 * layout function.
 */
function ExplanationPanelBody({
  analysis,
  status,
  error,
  links,
}: {
  analysis: RegexAnalysis | null;
  status: AnalysisStatus;
  error: WorkspaceFailure | null;
  links: SpanLinkHandlers;
}): React.JSX.Element {
  if (error !== null) {
    return (
      <div role="alert">
        <p>{error.message}</p>
        {error.hint !== undefined && <p className={styles.muted}>{error.hint}</p>}
      </div>
    );
  }

  if (analysis !== null)
    return <ExplanationView explanation={analysis.explanation} links={links} />;

  return (
    <p className={styles.muted}>
      {status === 'analyzing' ? 'Reading the pattern…' : 'Your explanation will appear here.'}
    </p>
  );
}

function ExamplePicker(): React.JSX.Element {
  return (
    <label className={styles.examplePicker}>
      <span className={styles.examplePickerLabel}>Example</span>
      {/* Native select: the platform already gets keyboard, screen-reader and
          mobile behaviour right, and every custom listbox regresses one of
          them (10_COMPONENT_ARCHITECTURE.md §3.3). */}
      <select
        className={styles.select}
        value=""
        onChange={(event) => {
          const example = EXAMPLES.find((candidate) => candidate.id === event.target.value);
          if (example) loadExample(example.pattern, example.subject, example.flags);
        }}
      >
        <option value="">Choose…</option>
        {EXAMPLES.map((example) => (
          <option key={example.id} value={example.id}>
            {example.label}
          </option>
        ))}
      </select>
    </label>
  );
}
