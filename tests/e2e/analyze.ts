import { expect, type Page } from '@playwright/test';

/**
 * Pressing Analyze, correctly — M15's explicit submission, M16's helper
 *
 * Since M15 nothing is analysed until Analyze is pressed, so a test that fills
 * an editor and waits for a result waits forever. That is the first half of
 * what this exists for.
 *
 * The second half is subtler and cost a suite's worth of failures. The button
 * signals unavailability with **`aria-disabled`, not `disabled`** — deliberate,
 * so that focus survives the press that made it unavailable
 * (`08_UI_UX_SPEC.md` §7.2). Playwright's `isEnabled()` and its actionability
 * checks both look at the `disabled` attribute, so they see a perfectly
 * clickable element, the click lands, and the handler refuses it. Nothing
 * happens, no error is raised, and the test times out somewhere else entirely.
 * Under parallel load the render lags the keystrokes often enough for that race
 * to fail most runs.
 *
 * So: wait for the control to actually become available, then press it — and
 * **fail here, saying why, if it never does**. An early version returned
 * quietly instead, which turned "the editor never received the text" into a
 * timeout three assertions later against a panel that was never asked to
 * update. A helper that silently does nothing is worse than one that throws.
 */

const NAMES = {
  pattern: 'Analyze pattern',
  json: 'Analyze JSON document',
  cron: 'Analyze cron expression',
} as const;

export type AnalyzeSubject = keyof typeof NAMES;

export interface PressOptions {
  /**
   * Tolerate the control never becoming available, and report whether it did.
   *
   * For the few callers where "there is nothing to submit" is a legitimate
   * outcome — an empty editor, or a result that already describes it. Every
   * other caller wants the loud failure.
   */
  readonly optional?: boolean;
  /**
   * Long enough for a render under parallel load, short enough that a control
   * which legitimately stays unavailable does not eat a test's whole budget.
   */
  readonly timeout?: number;
}

/**
 * The text the explanation panel shows when it has nothing to explain.
 *
 * Waiting for the panel itself proves nothing — it is always on screen, and it
 * holds this placeholder until an analysis lands. Several specs waited for the
 * region to be *visible* and therefore waited for nothing at all, then opened a
 * drawer before the analysis they had asked for had arrived.
 */
const PLACEHOLDER = /will appear here|Reading the pattern/;

/** Waits for an analysis to actually land, rather than for its container. */
export async function awaitAnalysis(page: Page, timeout = 15_000): Promise<void> {
  await expect(page.getByRole('region', { name: 'Explanation' }).first()).not.toContainText(
    PLACEHOLDER,
    { timeout },
  );
}

export async function pressAnalyze(
  page: Page,
  subject: AnalyzeSubject,
  options: PressOptions = {},
): Promise<boolean> {
  const { optional = false, timeout = 4_000 } = options;
  const button = page.getByRole('button', { name: NAMES[subject] });

  const available = await expect(button)
    .not.toHaveAttribute('aria-disabled', 'true', { timeout })
    .then(
      () => true,
      () => false,
    );

  if (available) {
    await button.click();
    return true;
  }

  if (optional) return false;

  // Say which precondition failed, rather than leaving the next assertion to
  // time out against an untouched panel.
  const state = await button
    .evaluate((element) => ({
      ariaDisabled: element.getAttribute('aria-disabled'),
      disabled: (element as HTMLButtonElement).disabled,
      visible: element.checkVisibility(),
    }))
    .catch(() => null);

  throw new Error(
    `"${NAMES[subject]}" never became available within ${String(timeout)} ms, so nothing was ` +
      `analysed. The usual cause is that the editor never received the text — the control is ` +
      `unavailable while there is nothing new to submit. Button state: ${JSON.stringify(state)}`,
  );
}
