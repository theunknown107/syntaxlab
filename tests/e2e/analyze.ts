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
 * So: wait for the control to actually become available, then press it.
 */

const NAMES = {
  pattern: 'Analyze pattern',
  json: 'Analyze JSON document',
  cron: 'Analyze cron expression',
} as const;

export type AnalyzeSubject = keyof typeof NAMES;

/**
 * Presses Analyze for one mode, once there is something to submit.
 *
 * Returns `false` when the control never became available, which is a real
 * state rather than a failure: an empty editor, or a result that already
 * describes what is on screen. Tests that rely on that keep working.
 */
export async function pressAnalyze(
  page: Page,
  subject: AnalyzeSubject,
  // Long enough for a render under parallel load, short enough that a control
  // which legitimately stays unavailable — an empty editor, or a result that
  // already describes it — does not eat a test's whole budget waiting.
  timeout = 4_000,
): Promise<boolean> {
  const button = page.getByRole('button', { name: NAMES[subject] });

  const available = await expect(button)
    .not.toHaveAttribute('aria-disabled', 'true', { timeout })
    .then(
      () => true,
      () => false,
    );

  if (available) await button.click();
  return available;
}
