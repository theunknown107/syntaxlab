import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * M1 smoke tests — 20_IMPLEMENTATION_PLAN.md task 1.4
 *
 * These run against the PRODUCTION build (see playwright.config.ts), because
 * the CSP, minification, and chunking we care about only exist there.
 *
 * The full E2E suite is M12. What M1 must prove is that the pipeline works and
 * that the shell's security and accessibility baselines actually hold in a
 * real browser rather than only in happy-dom.
 */

test('renders the shell without a fatal error', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('shows the SyntaxLab identity', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/SyntaxLab/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('SyntaxLab');
  await expect(page.getByText('Understand developer syntax instantly.')).toBeVisible();
});

test('switches mode with the keyboard alone', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('radio', { name: 'Regex' }).focus();
  await page.keyboard.press('ArrowRight');

  await expect(page.getByRole('radio', { name: 'JSON' })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'JSON input' })).toBeVisible();
});

test('reports no CSP violations during a session', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __cspViolations?: string[] }).__cspViolations ??= [];
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        `${event.violatedDirective}: ${event.blockedURI}`,
      );
    });
  });

  await page.goto('/');
  await page.getByRole('radio', { name: 'JSON' }).click();

  const recorded = await page.evaluate(
    () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
  );
  violations.push(...recorded);

  expect(violations).toEqual([]);
});

test('makes no network requests beyond its own assets', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://localhost:4173') external.push(request.url());
  });

  await page.goto('/');
  await page.getByRole('radio', { name: 'JSON' }).click();
  await page.waitForTimeout(500);

  // The privacy position depends on this being true, so it is asserted rather
  // than assumed (01_PRD.md §9, acceptance S-4).
  expect(external).toEqual([]);
});

test('has no critical or serious accessibility violations', async ({ page }) => {
  await page.goto('/');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );

  expect(blocking).toEqual([]);
});

test('is usable at a mobile viewport without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');

  await expect(page.getByRole('radio', { name: 'Regex' })).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
});
