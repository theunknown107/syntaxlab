import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '@/App';
import { workspaceStore } from '@/application/stores/workspaceStore';

describe('AppShell', () => {
  beforeEach(() => {
    workspaceStore.reset();
  });

  it('renders the landmark structure', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('has exactly one level-one heading', () => {
    render(<App />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('names the product and its purpose', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /SyntaxLab — understand developer syntax instantly/i,
      }),
    ).toBeInTheDocument();
  });

  it('provides a skip link as the first focusable element', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
  });

  it('exposes a polite live region for status', () => {
    render(<App />);

    // Scoped to the footer: M4 added further polite regions inside the
    // workspace for match results, so "the status bar" has to be named
    // rather than assumed to be the only one.
    const status = within(screen.getByRole('contentinfo')).getByRole('status');

    // Established at M1 so every later feature inherits a working
    // announcement channel. Polite, never assertive: results must not
    // interrupt a screen-reader user mid-sentence (08_UI_UX_SPEC.md §12.2).
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('shows the permanent ECMAScript label in regex mode', () => {
    render(<App />);

    // Non-dismissible by design. A user must never assume the tester's
    // results transfer to PCRE or Python (risk R-21).
    expect(screen.getByText('ECMAScript (JavaScript)')).toBeInTheDocument();
  });

  it('hides the ECMAScript label in JSON mode', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('radio', { name: 'JSON' }));

    expect(screen.queryByText('ECMAScript (JavaScript)')).not.toBeInTheDocument();
  });

  it('switches the workspace with the mode', async () => {
    const user = userEvent.setup();
    render(<App />);

    // From M4 the regex mode is the real feature, so its input pane is the
    // pattern editor rather than the shared placeholder.
    expect(screen.getByRole('heading', { name: 'Pattern' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'JSON' }));

    // From M6 both modes are real features, so the JSON pane is the editor
    // rather than the shared placeholder.
    expect(screen.getByRole('heading', { name: /^JSON/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pattern' })).not.toBeInTheDocument();
  });

  it('does not offer any cron affordance', () => {
    render(<App />);

    // V1.0 must read as complete rather than partial. A disabled or
    // "coming soon" cron control anywhere in the workspace is a defect
    // (21_ACCEPTANCE_CRITERIA.md M-8).
    expect(screen.queryByText(/cron/i)).not.toBeInTheDocument();
  });

  it('renders no disabled controls', () => {
    const { container } = render(<App />);

    // Queried by attribute rather than by role: the assertion is "nothing
    // anywhere is disabled", and a disabled affordance is a defect regardless
    // of which role it carries (21_ACCEPTANCE_CRITERIA.md M-8).
    const disabled = container.querySelectorAll('[disabled], [aria-disabled="true"]');

    expect(Array.from(disabled)).toHaveLength(0);
  });
});
