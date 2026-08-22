import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CronAnalysis } from '@/domain/cron/ast';
import { LIMITS } from '@/domain/shared/limits';
import type { SourceSpan } from '@/domain/shared/result';
import {
  analyzeCronNow,
  clearCron,
  loadCronExample,
  setCronInput,
  setCronTimezoneMode,
} from '@/application/cron/cronWorkspace';
import {
  submissionOf,
  workspaceStore,
  type WorkspaceFailure,
} from '@/application/stores/workspaceStore';
import { useStore } from '@/components/hooks/useStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CodeEditor, type EditorRange, type EditorSelection } from '@/components/editor/CodeEditor';
import { ExplanationView, type SpanLinkHandlers } from '@/components/ExplanationView';
import { AnalyzeAction, AnalyzeStatus } from '@/components/primitives/AnalyzeAction';
import { Badge, Button } from '@/components/primitives/Button';
import { CopyButton } from '@/components/primitives/CopyButton';
import { Panel } from '@/components/primitives/Panel';
import { Splitter } from '@/components/primitives/Splitter';

import { CronFields } from './CronFields';
import { CronSchedule } from './CronSchedule';
import styles from './cron.module.css';

/**
 * The cron workspace — 08_UI_UX_SPEC.md §7.3, 10_COMPONENT_ARCHITECTURE.md §4.3
 *
 * The same two columns as regex and JSON, using the same Panel, CodeEditor,
 * ExplanationView, Splitter and Analyze control. Cron is a third mode, not a
 * third application.
 *
 * M16 adds the next-run panel. There is still **no calendar and no timezone
 * picker**: the domain resolves two modes and no named zones, and a picker for
 * zones it cannot compute would promise an answer this build cannot give.
 */

/** Worked examples. Enough to show the shape, short enough to read. */
const EXAMPLES: readonly { readonly expression: string; readonly label: string }[] = [
  { expression: '*/15 9-17 * * 1-5', label: 'Every 15 minutes, office hours, weekdays' },
  { expression: '0 0 * * *', label: 'Daily at midnight' },
  { expression: '0 0 1 * *', label: 'The first of every month' },
  { expression: '@weekly', label: 'A macro' },
];

export function CronWorkspace(): React.JSX.Element {
  const input = useStore(workspaceStore, (state) => state.cronInput);
  const committed = useStore(workspaceStore, (state) => state.cronCommitted);
  const analysis = useStore(workspaceStore, (state) => state.cronAnalysis);
  const status = useStore(workspaceStore, (state) => state.cronStatus);
  const failure = useStore(workspaceStore, (state) => state.cronError);
  const timezoneMode = useStore(workspaceStore, (state) => state.cronTimezoneMode);
  const schedule = useStore(workspaceStore, (state) => state.cronSchedule);
  const scheduleStatus = useStore(workspaceStore, (state) => state.cronScheduleStatus);
  const scheduleError = useStore(workspaceStore, (state) => state.cronScheduleError);

  const [hoveredSpan, setHoveredSpan] = useState<SourceSpan | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const nonce = useRef(0);

  const submission = submissionOf(input, committed);
  const busy = status === 'analyzing';

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

  // `Ctrl/⌘ + Enter` analyses. Plain Enter is left alone: the editor is single
  // line, but binding Enter here would be a different rule from the other two
  // modes for no gain, and one interaction is easier to learn than three.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        analyzeCronNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  /* Errors and the hovered field, marked in the editor itself. Same class
     names the other modes use, so one stylesheet covers all three. */
  const ranges = useMemo<EditorRange[]>(() => {
    const marks: EditorRange[] = [];
    for (const error of analysis?.errors ?? []) {
      const span = error.span;
      if (span === undefined || span.start >= span.end) continue;
      marks.push({ from: span.start, to: span.end, className: 'json-error' });
    }
    if (hoveredSpan !== null && hoveredSpan.start < hoveredSpan.end) {
      marks.push({ from: hoveredSpan.start, to: hoveredSpan.end, className: 'tok-linked' });
    }
    return marks;
  }, [analysis, hoveredSpan]);

  const onExample = useCallback((expression: string) => {
    loadCronExample(expression);
  }, []);

  return (
    <div className={styles.workspace}>
      <ErrorBoundary scope="input">
        <div className={styles.column}>
          <Panel
            title="Cron expression"
            actions={
              <>
                <span className={styles.dialect} title="The only dialect SyntaxLab supports.">
                  Standard 5-field
                </span>
                <CopyButton getText={() => input} label="Copy" />
                <Button onClick={clearCron} variant="ghost">
                  Clear
                </Button>
              </>
            }
          >
            <CodeEditor
              value={input}
              onChange={setCronInput}
              ariaLabel="Cron expression"
              ariaDescribedBy="cron-help"
              maxLength={LIMITS.cron.input}
              placeholder="*/15 9-17 * * 1-5"
              ranges={ranges}
              selection={selection}
              singleLine
            />

            <p id="cron-help" className={styles.help}>
              Five fields, separated by spaces: minute, hour, day of month, month, day of week.
              Expressions with six or seven fields belong to other schedulers and are refused rather
              than guessed at. Nothing is uploaded.
            </p>

            <FieldLegend />

            <div className={styles.inputFooter}>
              <AnalyzeAction
                submission={submission}
                busy={busy}
                onAnalyze={analyzeCronNow}
                subject="cron expression"
              />
              <TimezoneToggle mode={timezoneMode} zone={analysis?.timezone.ianaZone ?? null} />
            </div>
            <AnalyzeStatus submission={submission} busy={busy} subject="cron expression" />

            <div className={styles.examples}>
              <span className={styles.examplesLabel}>Examples</span>
              {EXAMPLES.map((example) => (
                <Button
                  key={example.expression}
                  onClick={() => {
                    onExample(example.expression);
                  }}
                  variant="ghost"
                  ariaLabel={`Load example: ${example.label}`}
                >
                  <code>{example.expression}</code>
                </Button>
              ))}
            </div>
          </Panel>
        </div>
      </ErrorBoundary>

      <Splitter label="Resize the expression and explanation panels" />

      <ErrorBoundary scope="analysis">
        <div className={styles.column}>
          <Panel title="Fields">
            {analysis === null ? (
              <EmptyOrError failure={failure} status={status} />
            ) : (
              <CronFields analysis={analysis} links={links} />
            )}
          </Panel>

          <Panel title="Next runs">
            <CronSchedule
              preview={schedule}
              status={scheduleStatus}
              failure={scheduleError}
              hasAnalysis={analysis !== null}
            />
          </Panel>

          <Panel title="Explanation">
            <CronExplanation analysis={analysis} failure={failure} status={status} links={links} />
          </Panel>
        </div>
      </ErrorBoundary>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Supporting pieces
 * ------------------------------------------------------------------ */

/**
 * The five positions, always visible.
 *
 * The single most common cron mistake is editing the wrong position, and this
 * costs one line to prevent.
 */
function FieldLegend(): React.JSX.Element {
  return (
    <ol className={styles.legend} aria-label="The five fields, in order">
      {['minute', 'hour', 'day of month', 'month', 'day of week'].map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ol>
  );
}

interface TimezoneToggleProps {
  readonly mode: 'browserLocal' | 'utc';
  readonly zone: string | null;
}

/**
 * Two modes, and no more.
 *
 * Radio buttons rather than a select, because a select implies a list that
 * could grow — and this one cannot. Named IANA zones are not implemented, and
 * offering a picker for them would promise an answer the domain cannot give
 * (`04_PARSER_ARCHITECTURE.md` §4.5).
 */
function TimezoneToggle({ mode, zone }: TimezoneToggleProps): React.JSX.Element {
  return (
    <fieldset className={styles.timezone}>
      <legend className={styles.timezoneLegend}>Times read in</legend>
      <label>
        <input
          type="radio"
          name="cronTimezone"
          checked={mode === 'browserLocal'}
          onChange={() => {
            setCronTimezoneMode('browserLocal');
          }}
        />
        <span>
          This browser
          {mode === 'browserLocal' && zone !== null && (
            <span className={styles.zoneName}> ({zone})</span>
          )}
        </span>
      </label>
      <label>
        <input
          type="radio"
          name="cronTimezone"
          checked={mode === 'utc'}
          onChange={() => {
            setCronTimezoneMode('utc');
          }}
        />
        <span>UTC</span>
      </label>
    </fieldset>
  );
}

interface StateProps {
  readonly failure: WorkspaceFailure | null;
  readonly status: 'idle' | 'analyzing' | 'ready' | 'error';
}

function EmptyOrError({ failure, status }: StateProps): React.JSX.Element {
  if (status === 'analyzing') return <p className={styles.empty}>Analyzing…</p>;
  if (failure !== null) return <RefusalNotice failure={failure} />;
  return (
    <p className={styles.empty}>
      Type an expression and press Analyze. Nothing is analysed as you type.
    </p>
  );
}

/**
 * A refusal, presented as an answer rather than a failure.
 *
 * "This has six fields and SyntaxLab supports five" is the most useful thing
 * this feature says, and the hint that follows turns it into a next step. It
 * is styled as information, not as a crash.
 */
function RefusalNotice({ failure }: { readonly failure: WorkspaceFailure }): React.JSX.Element {
  return (
    <div className={styles.refusal} role="status">
      <Badge tone="warning">Not analysed</Badge>
      <p className={styles.refusalMessage}>{failure.message}</p>
      {failure.hint !== undefined && <p className={styles.refusalHint}>{failure.hint}</p>}
    </div>
  );
}

interface ExplanationProps extends StateProps {
  readonly analysis: CronAnalysis | null;
  readonly links: SpanLinkHandlers;
}

function CronExplanation({
  analysis,
  failure,
  status,
  links,
}: ExplanationProps): React.JSX.Element {
  if (analysis === null) return <EmptyOrError failure={failure} status={status} />;

  return (
    <>
      {analysis.warnings.length > 0 && (
        <ul className={styles.warnings} aria-label="Warnings">
          {analysis.warnings.map((warning) => (
            <li key={warning.code} className={styles.warning}>
              <Badge tone="warning">Note</Badge>
              <span>
                {warning.message}
                {warning.hint !== undefined && (
                  <span className={styles.warningHint}> {warning.hint}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ExplanationView explanation={analysis.explanation} links={links} />
    </>
  );
}
