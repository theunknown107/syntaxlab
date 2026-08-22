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

  it('offers cron as a real mode, not a promise', () => {
    render(<App />);

    // Until M15 this asserted that no cron affordance existed at all, because
    // V1.0 had to read as complete rather than partial. Cron now exists, so
    // the rule it was protecting applies in its original form: the control is
    // there and it works (21_ACCEPTANCE_CRITERIA.md M-8).
    const cron = screen.getByRole('radio', { name: 'Cron' });
    expect(cron).toBeEnabled();
    expect(screen.queryByText(/coming soon|not yet available/i)).not.toBeInTheDocument();
  });

  it('renders no control that is disabled because the feature is missing', () => {
    const { container } = render(<App />);

    // The assertion is still "nothing advertises an absent feature", but a
    // control may legitimately be disabled for the state it is in. Analyze on
    // an empty editor is the case: there is nothing to analyse yet, and a
    // button that submits nothing is worse than one that waits.
    const disabled = Array.from(
      container.querySelectorAll('[disabled], [aria-disabled="true"]'),
    ).filter((element) => !(element.getAttribute('aria-label') ?? '').startsWith('Analyze '));

    expect(disabled).toHaveLength(0);
  });

  it('marks Analyze unavailable on an empty editor, without removing it from the tab order', () => {
    render(<App />);
    const analyze = screen.getByRole('button', { name: 'Analyze pattern' });
    expect(analyze).toHaveAttribute('aria-disabled', 'true');
    expect(analyze).toBeEnabled();
  });
});
