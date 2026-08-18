import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ModeSelector } from '@/app/ModeSelector';
import { workspaceStore } from '@/application/stores/workspaceStore';

/**
 * Queried by role and accessible name throughout, never by test id or class.
 * A test that cannot find a control by its accessible name has found a real
 * accessibility bug (10_COMPONENT_ARCHITECTURE.md §8).
 */
describe('ModeSelector', () => {
  beforeEach(() => {
    workspaceStore.reset();
  });

  it('exposes a labelled radiogroup', () => {
    render(<ModeSelector />);
    expect(screen.getByRole('radiogroup', { name: 'Analysis mode' })).toBeInTheDocument();
  });

  it('renders exactly the two V1.0 modes', () => {
    render(<ModeSelector />);
    const options = screen.getAllByRole('radio');

    // V1.0 is Regex + JSON. A third segment appearing here means cron leaked
    // into V1.0, which the release scope forbids (22_OPEN_QUESTIONS.md D-01).
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.textContent)).toEqual(['Regex', 'JSON']);
  });

  it('marks regex as the default selection', () => {
    render(<ModeSelector />);
    expect(screen.getByRole('radio', { name: 'Regex' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'JSON' })).not.toBeChecked();
  });

  it('selects a mode on click and updates the store', async () => {
    const user = userEvent.setup();
    render(<ModeSelector />);

    await user.click(screen.getByRole('radio', { name: 'JSON' }));

    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked();
    expect(workspaceStore.getState().mode).toBe('json');
  });

  it('moves selection with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<ModeSelector />);

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Regex' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'JSON' })).toHaveFocus();
  });

  it('wraps around when arrowing past the end', async () => {
    const user = userEvent.setup();
    render(<ModeSelector />);

    await user.tab();
    await user.keyboard('{ArrowLeft}');

    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked();
  });

  it('keeps only the selected option in the tab order', async () => {
    const user = userEvent.setup();
    render(<ModeSelector />);

    await user.tab();

    // Roving tabindex: tabbing again must leave the group entirely rather
    // than step through every option.
    expect(screen.getByRole('radio', { name: 'Regex' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'JSON' })).toHaveAttribute('tabindex', '-1');
  });
});
