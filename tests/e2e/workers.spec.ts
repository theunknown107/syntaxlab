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
    // From M6 the JSON mode is the real feature, so its pane is the editor.
    await expect(page.getByRole('heading', { name: /^JSON/ })).toBeVisible();

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

/**
 * Worker integration — M3.
 *
 * Proves the regex domain genuinely runs inside the analysis worker and that
 * the result survives the structured-clone boundary and the runtime validator
 * on the way back. No UI is involved.
 */
test.describe('regex analysis through the worker', () => {
  test('returns a validated RegexAnalysis', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() =>
      window.__syntaxlabDev!.regex('^[A-Z][a-z]+$', ''),
    );

    expect(outcome.ok).toBe(true);
    const analysis = outcome.value as {
      kind: string;
      source: string;
      groups: unknown[];
      explanation: { summary: unknown[] };
      tokens: unknown[];
    };
    expect(analysis.kind).toBe('regex');
    expect(analysis.source).toBe('^[A-Z][a-z]+$');
    expect(analysis.tokens.length).toBeGreaterThan(5);
    expect(analysis.explanation.summary.length).toBeGreaterThan(0);
  });

  test('numbers capture groups across the boundary', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() =>
      window.__syntaxlabDev!.regex('(a)(?<mid>b)(c)', ''),
    );

    const analysis = outcome.value as { groups: { number: number; name?: string }[] };
    expect(analysis.groups.map((group) => group.number)).toEqual([1, 2, 3]);
    expect(analysis.groups[1]?.name).toBe('mid');
  });

  test('reports a foreign dialect with its origin', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() =>
      window.__syntaxlabDev!.regex(String.raw`(?P<year>\d+)`, ''),
    );

    const analysis = outcome.value as { errors: { code: string; message: string }[] };
    expect(analysis.errors.some((error) => error.code === 'UNSUPPORTED')).toBe(true);
    expect(analysis.errors.some((error) => error.message.includes('Python'))).toBe(true);
  });

  test('rejects an over-limit pattern in the worker, not only in the UI', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() =>
      window.__syntaxlabDev!.regex('a'.repeat(10_001), ''),
    );

    // The worker never trusts its caller: the limit is enforced here even
    // though the editor will also enforce it.
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('DOMAIN');
    expect(outcome.message).toMatch(/limit/i);
  });

  test('keeps the analysis worker alive after an execution timeout', async ({ page }) => {
    test.setTimeout(60_000);
    await ready(page);

    await page.evaluate(
      (deadline) => window.__syntaxlabDev!.spin(deadline * 15, deadline),
      EXEC_DEADLINE_MS,
    );

    // The isolation invariant, now with real parser state at stake rather
    // than a stub.
    const outcome: Outcome = await page.evaluate(() => window.__syntaxlabDev!.regex('(a+)+', ''));
    expect(outcome.ok).toBe(true);
    const analysis = outcome.value as { warnings: { code: string }[] };
    expect(analysis.warnings.some((warning) => warning.code === 'NESTED_QUANTIFIER')).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * JSON analysis through the worker — M5
 * ------------------------------------------------------------------ */

test.describe('JSON analysis through the worker', () => {
  test('parses a document and returns a validated tree', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() =>
      window.__syntaxlabDev!.json('{"id":1,"tags":["a","b"]}'),
    );

    expect(outcome.ok).toBe(true);
    const analysis = outcome.value as {
      kind: string;
      valid: boolean;
      stats: { nodeCount: number; maxDepth: number };
      cst: { type: string; members: { key: string }[] };
    };

    expect(analysis.kind).toBe('json');
    expect(analysis.valid).toBe(true);
    expect(analysis.cst.type).toBe('object');
    expect(analysis.cst.members.map((member) => member.key)).toEqual(['id', 'tags']);
    expect(analysis.stats.maxDepth).toBe(2);
  });

  test('object members survive structured clone as an array, not a record', async ({ page }) => {
    await ready(page);

    // The prototype-pollution defence has to hold across the worker boundary,
    // not only inside the domain: `structuredClone` is what actually moves
    // this data between threads.
    const shape: string = await page.evaluate(async () => {
      const outcome = await window.__syntaxlabDev!.json('{"__proto__":{"polluted":true}}');
      const analysis = outcome.value as { cst: { members: unknown } };
      return Array.isArray(analysis.cst.members) ? 'array' : 'record';
    });

    expect(shape).toBe('array');

    const polluted: boolean = await page.evaluate(() => 'polluted' in Object.prototype);
    expect(polluted).toBe(false);
  });

  test('reports a syntax error with a position rather than throwing', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() =>
      window.__syntaxlabDev!.json('{\n  "a": 1,\n}'),
    );

    expect(outcome.ok).toBe(true);
    const analysis = outcome.value as {
      valid: boolean;
      errors: { message: string; span?: { line: number } }[];
    };
    expect(analysis.valid).toBe(false);
    expect(analysis.errors[0]?.message).toMatch(/Trailing comma/);
    expect(analysis.errors[0]?.span?.line).toBe(3);
  });

  test('reports duplicate keys and unsafe numbers', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() =>
      window.__syntaxlabDev!.json('{"a":1,"a":2,"id":9007199254740993}'),
    );

    const analysis = outcome.value as {
      duplicateKeys: { key: string; occurrences: unknown[] }[];
      unsafeNumbers: { reason: string }[];
    };
    expect(analysis.duplicateKeys[0]?.key).toBe('a');
    expect(analysis.duplicateKeys[0]?.occurrences).toHaveLength(2);
    expect(analysis.unsafeNumbers[0]?.reason).toBe('PRECISION_LOSS');
  });

  test('rejects an over-limit document in the worker, not only in the UI', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() =>
      window.__syntaxlabDev!.json(`"${'a'.repeat(5_000_001)}"`),
    );

    // The worker never trusts its caller.
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('DOMAIN');
    expect(outcome.message).toMatch(/limit/i);
  });

  test('survives nesting that would exhaust a recursive parser', async ({ page }) => {
    await ready(page);

    const outcome: Outcome = await page.evaluate(() =>
      window.__syntaxlabDev!.json('['.repeat(100_000)),
    );

    expect(outcome.ok).toBe(true);
    const analysis = outcome.value as { errors: { code: string }[] };
    expect(analysis.errors.some((error) => error.code === 'LIMIT_EXCEEDED')).toBe(true);

    // And the worker is still usable afterwards.
    const next: Outcome = await page.evaluate(() => window.__syntaxlabDev!.json('{"a":1}'));
    expect(next.ok).toBe(true);
  });

  test('does not disturb regex analysis on the same worker', async ({ page }) => {
    await ready(page);

    const outcomes = await page.evaluate(async () => {
      const json = await window.__syntaxlabDev!.json('{"a":[1,2,3]}');
      const regex = await window.__syntaxlabDev!.regex('(a+)+', '');
      return { json: json.ok, regex: regex.ok };
    });

    expect(outcomes).toEqual({ json: true, regex: true });
  });
});
