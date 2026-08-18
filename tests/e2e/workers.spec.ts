import { expect, test, type Page } from '@playwright/test';

/**
 * Real workers, real browsers — M2 risk checkpoint R-10.
 *
 * These run on Chromium, Firefox, and WebKit because the property being
 * verified is engine behaviour: that `Worker.terminate()` actually stops a
 * thread that cannot yield. The entire ReDoS defence rests on it, so it is
 * proven per engine rather than assumed from one.
 *
 * They drive the development-only harness (see `src/app/devWorkerHarness.ts`).
 * `shell.spec.ts` asserts that harness is absent from production builds.
 */

/** Matches LIMITS.regex.execMs. */
const EXEC_DEADLINE_MS = 2000;

interface Outcome {
  ok: boolean;
  code?: string;
  message?: string;
  value?: unknown;
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__syntaxlabDev !== undefined);
}

test.describe('analysis worker — long-lived', () => {
  test('completes a round trip', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() => window.__syntaxlabDev!.ping());

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ pong: true });
  });

  test('actually processes the payload rather than echoing it back', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() => window.__syntaxlabDev!.echo('hello worker'));

    // `length` is derived inside the worker, so a correct value proves the
    // work happened there rather than on the main thread.
    expect(outcome.value).toEqual({ text: 'hello worker', length: 12 });
  });

  test('handles many concurrent requests without crossing responses', async ({ page }) => {
    await ready(page);

    const results: Outcome[] = await page.evaluate(async () => {
      const texts = ['a', 'bb', 'ccc', 'dddd', 'eeeee'];
      return Promise.all(texts.map((text) => window.__syntaxlabDev!.echo(text)));
    });

    expect(results.map((r) => (r.value as { length: number }).length)).toEqual([1, 2, 3, 4, 5]);
  });
});

test.describe('execution worker — timeout, termination, respawn', () => {
  test('completes work that finishes inside the deadline', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() => window.__syntaxlabDev!.spin(50));

    expect(outcome.ok).toBe(true);
    expect(outcome.value).toMatchObject({ completed: true });
  });

  test('terminates a thread that cannot yield, then serves the next request', async ({ page }) => {
    test.setTimeout(60_000);
    await ready(page);

    // The spin is a busy loop: the worker cannot process messages, so there
    // is no cooperative way to stop it. Termination is the only exit.
    const timedOut: Outcome = await page.evaluate(
      (deadline) => window.__syntaxlabDev!.spin(deadline * 15, deadline),
      EXEC_DEADLINE_MS,
    );

    expect(timedOut.ok).toBe(false);
    expect(timedOut.code).toBe('TIMEOUT');

    // The replacement is spawned eagerly, so this must succeed promptly and
    // not merely eventually.
    const afterRespawn: Outcome = await page.evaluate(() => window.__syntaxlabDev!.spin(50));

    expect(afterRespawn.ok).toBe(true);
    expect(afterRespawn.value).toMatchObject({ completed: true });
  });

  test('settles close to the deadline rather than waiting for the work', async ({ page }) => {
    test.setTimeout(60_000);
    await ready(page);

    const elapsed: number = await page.evaluate(async (deadline) => {
      const startedAt = performance.now();
      await window.__syntaxlabDev!.spin(deadline * 15, deadline);
      return performance.now() - startedAt;
    }, EXEC_DEADLINE_MS);

    // Proves the caller is released at the deadline, not after the 30s task.
    expect(elapsed).toBeGreaterThanOrEqual(EXEC_DEADLINE_MS * 0.8);
    expect(elapsed).toBeLessThan(EXEC_DEADLINE_MS * 3);
  });

  test('survives repeated timeouts', async ({ page }) => {
    test.setTimeout(90_000);
    await ready(page);

    for (let attempt = 0; attempt < 3; attempt++) {
      const timedOut: Outcome = await page.evaluate(
        (deadline) => window.__syntaxlabDev!.spin(deadline * 10, deadline),
        EXEC_DEADLINE_MS,
      );
      expect(timedOut.code).toBe('TIMEOUT');
    }

    const recovered: Outcome = await page.evaluate(() => window.__syntaxlabDev!.spin(50));
    expect(recovered.ok).toBe(true);
  });
});

test.describe('isolation invariant', () => {
  test('an execution timeout does not disturb the analysis worker', async ({ page }) => {
    test.setTimeout(60_000);
    await ready(page);

    // Warm the analysis worker so there is real state to lose.
    const before: Outcome = await page.evaluate(() => window.__syntaxlabDev!.echo('before'));
    expect(before.ok).toBe(true);

    const timedOut: Outcome = await page.evaluate(
      (deadline) => window.__syntaxlabDev!.spin(deadline * 15, deadline),
      EXEC_DEADLINE_MS,
    );
    expect(timedOut.code).toBe('TIMEOUT');

    // The invariant M2 exists to establish: killing the execution worker must
    // not touch unrelated analysis state (02_ARCHITECTURE.md §4.3).
    const after: Outcome = await page.evaluate(() => window.__syntaxlabDev!.echo('after'));
    expect(after.ok).toBe(true);
    expect(after.value).toEqual({ text: 'after', length: 5 });

    const analysisStatus: string = await page.evaluate(() =>
      window.__syntaxlabDev!.analysisStatus(),
    );
    expect(analysisStatus).toBe('ready');
  });
});

test.describe('main-thread responsiveness', () => {
  test('the UI stays interactive while the execution worker is blocked', async ({ page }) => {
    test.setTimeout(60_000);
    await ready(page);

    // Start a spin that will exceed its deadline, without awaiting it: the
    // execution worker is now genuinely unable to yield.
    await page.evaluate((deadline) => {
      (window as unknown as { __spinPromise?: Promise<unknown> }).__spinPromise =
        window.__syntaxlabDev!.spin(deadline * 15, deadline);
    }, EXEC_DEADLINE_MS);

    // Interact with a real control while that thread is pinned. If execution
    // were on the main thread, this click could not be handled at all.
    await page.getByRole('radio', { name: 'JSON' }).click();
    await expect(page.getByRole('radio', { name: 'JSON' })).toBeChecked();
    await expect(page.getByRole('heading', { name: 'JSON input' })).toBeVisible();

    // And again after the timeout, termination, and respawn.
    const outcome: Outcome = await page.evaluate(
      () => (window as unknown as { __spinPromise: Promise<Outcome> }).__spinPromise,
    );
    expect(outcome.code).toBe('TIMEOUT');

    await page.getByRole('radio', { name: 'Regex' }).click();
    await expect(page.getByRole('radio', { name: 'Regex' })).toBeChecked();
  });
});

test.describe('capability detection', () => {
  test('reports execution as available when workers are supported', async ({ page }) => {
    await ready(page);

    const available: boolean = await page.evaluate(() =>
      window.__syntaxlabDev!.executionAvailable(),
    );

    expect(available).toBe(true);
  });
});
