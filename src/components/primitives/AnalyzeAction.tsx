import type { SubmissionState } from '@/application/stores/workspaceStore';

import { Badge, Button } from './Button';
import styles from './primitives.module.css';

/**
 * The submit control — 08_UI_UX_SPEC.md §5, 10_COMPONENT_ARCHITECTURE.md §3.3
 *
 * One control, used identically by regex, JSON and cron. Three separate
 * versions of "press this to analyse" would drift in wording, in disabled
 * rules and in what they announce, and a user who learned the interaction in
 * one mode would have to learn it again in the next.
 *
 * **"Analyze", not "Send".** The action is semantic — it asks for an
 * explanation of what is in the editor — and the application already says
 * "analysis" everywhere else, from the panel headings to the worker operation
 * names. "Send" would be the only word in the interface implying the text goes
 * somewhere, which is exactly the impression an app that makes no network
 * requests should not give.
 *
 * The stale badge sits beside the button rather than over the result, because
 * the result is still correct — it describes the last submitted input, and
 * saying so is more useful than greying it out.
 */

export interface AnalyzeActionProps {
  readonly submission: SubmissionState;
  /** True while the worker is busy with the last submission. */
  readonly busy: boolean;
  readonly onAnalyze: () => void;
  /** What is being analysed, for the accessible name: "Analyze pattern". */
  readonly subject: string;
}

export function AnalyzeAction({
  submission,
  busy,
  onAnalyze,
  subject,
}: AnalyzeActionProps): React.JSX.Element {
  const disabled = busy || !submission.submittable;

  return (
    <div className={styles.analyzeAction}>
      {submission.stale && (
        // Announced politely: the user caused it by typing, so they do not
        // need interrupting to be told about it.
        <Badge tone="warning">Unanalyzed changes</Badge>
      )}
      <Button
        onClick={onAnalyze}
        variant="primary"
        disabled={disabled}
        // Pressing this is what makes it unavailable — there is nothing left
        // to submit once the analysis lands. A real `disabled` would blur it
        // at that moment and drop a keyboard user back to the document top.
        keepFocusWhenDisabled
        // Named for what it analyses. "Analyze" alone, repeated in three
        // modes, gives a screen-reader user listing the buttons no way to
        // tell which editor it belongs to.
        ariaLabel={`Analyze ${subject}`}
        title="Analyze (Ctrl or ⌘ + Enter)"
      >
        {busy ? 'Analyzing…' : 'Analyze'}
      </Button>
    </div>
  );
}

/**
 * The live-region half of the same interaction.
 *
 * Kept separate from the button so the announcement is not tied to the
 * button's own label changing — a screen reader reading a label mid-press is
 * not the same as being told the state changed.
 */
export function AnalyzeStatus({
  submission,
  busy,
  subject,
}: Omit<AnalyzeActionProps, 'onAnalyze'>): React.JSX.Element {
  const message = busy
    ? `Analyzing ${subject}.`
    : submission.stale
      ? `The editor has changes that have not been analyzed. Press Analyze to update the ${subject} explanation.`
      : '';

  return (
    <p aria-live="polite" className={styles.srOnly}>
      {message}
    </p>
  );
}
