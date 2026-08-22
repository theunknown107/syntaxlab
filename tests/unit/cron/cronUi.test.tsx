import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { analyzeCron } from '@/domain/cron/analyze';
import type { CronAnalysis } from '@/domain/cron/ast';
import type { SpanLinkHandlers } from '@/components/ExplanationView';
import { AnalyzeAction, AnalyzeStatus } from '@/components/primitives/AnalyzeAction';
import { submissionOf } from '@/application/stores/workspaceStore';
import { CronFields } from '@/features/cron/CronFields';

/**
 * Cron UI — M15
 *
 * Queried by role and accessible name, never by test id or class: a component
 * that cannot be found by its accessible name has an accessibility bug, and
 * the query failing is the report (10_COMPONENT_ARCHITECTURE.md §8).
 *
 * The analyses are produced by the real domain rather than by fixtures, so a
 * change in what the parser reports shows up here as a rendering change rather
 * than as two files quietly disagreeing.
 */

const links: SpanLinkHandlers = { onHover: vi.fn(), onSelect: vi.fn() };

function analyse(source: string): CronAnalysis {
  const result = analyzeCron(source, { timezoneMode: 'utc' });
  if (!result.ok) throw new Error(`expected ${source} to analyse: ${result.error.message}`);
  return result.value;
}

/* ------------------------------------------------------------------ *
 * The field breakdown
 * ------------------------------------------------------------------ */

describe('the field table', () => {
  it('shows all five fields, in order, with what each selects', () => {
    render(<CronFields analysis={analyse('*/15 9-17 * * 1-5')} links={links} />);

    const rows = screen.getAllByRole('row').slice(1); // minus the header
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => within(row).getAllByRole('rowheader')[0]?.textContent)).toEqual([
      expect.stringContaining('minute'),
      expect.stringContaining('hour'),
      expect.stringContaining('day of the month'),
      expect.stringContaining('month'),
      expect.stringContaining('day of the week'),
    ]);
  });

  it('names every field in words, not by position alone', () => {
    // The commonest cron mistake is editing the wrong position. A table of
    // five unlabelled columns would reproduce it rather than prevent it.
    render(<CronFields analysis={analyse('0 0 * * *')} links={links} />);
    const names = screen
      .getAllByRole('rowheader')
      .map((header) => header.textContent.replace(/\d+–\d+$/, ''));
    expect(names).toEqual(['minute', 'hour', 'day of the month', 'month', 'day of the week']);
  });

  it('shows the legal range for each field', () => {
    render(<CronFields analysis={analyse('0 0 * * *')} links={links} />);
    expect(screen.getByText('0–59')).toBeInTheDocument();
    expect(screen.getByText('1–31')).toBeInTheDocument();
  });

  it('links each field back to its own text in the expression', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <CronFields analysis={analyse('*/15 9-17 * * 1-5')} links={{ onHover: vi.fn(), onSelect }} />,
    );

    await user.click(screen.getByRole('button', { name: /^minute: \*\/15\./ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ start: 0, end: 4 });
  });

  it('still shows five rows when a field is wrong, and says what is wrong in words', () => {
    // A table that appeared only on success would vanish exactly when the
    // user needs help locating the bad field.
    render(<CronFields analysis={analyse('99 12 * * *')} links={links} />);

    expect(screen.getAllByRole('row').slice(1)).toHaveLength(5);
    // The message, not only a colour (08_UI_UX_SPEC.md §12.1).
    expect(screen.getByText(/out of range/i)).toBeInTheDocument();
  });

  it('says a macro has no clock fields rather than inventing five', () => {
    render(<CronFields analysis={analyse('@reboot')} links={links} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/no clock fields/i)).toBeInTheDocument();
  });

  it('gives a count instead of a long list when a field selects many values', () => {
    // Not a wildcard — that reads "every value". A wide explicit range is the
    // case where listing every number would be longer than the sentence it is
    // meant to clarify.
    render(<CronFields analysis={analyse('1-30 0 * * *')} links={links} />);
    expect(screen.getByText('30 values')).toBeInTheDocument();
  });

  it('says "every value" for a wildcard rather than counting to sixty', () => {
    render(<CronFields analysis={analyse('* 0 * * *')} links={links} />);
    expect(screen.getAllByText('every value').length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * The Analyze control
 * ------------------------------------------------------------------ */

describe('the Analyze control', () => {
  const idle = submissionOf('', null);
  const ready = submissionOf('0 0 * * *', null);
  const stale = submissionOf('0 0 * * 1', '0 0 * * *');
  const settled = submissionOf('0 0 * * *', '0 0 * * *');

  it('is named for what it analyses, so three of them are distinguishable', () => {
    render(
      <AnalyzeAction
        submission={ready}
        busy={false}
        onAnalyze={vi.fn()}
        subject="cron expression"
      />,
    );
    expect(screen.getByRole('button', { name: 'Analyze cron expression' })).toBeInTheDocument();
  });

  it('is unavailable when there is nothing to analyse, without losing its place', () => {
    // `aria-disabled` rather than `disabled`: pressing this button is what
    // makes it unavailable, and a real `disabled` would blur it at that
    // moment and drop a keyboard user back to the top of the document.
    render(<AnalyzeAction submission={idle} busy={false} onAnalyze={vi.fn()} subject="pattern" />);
    const button = screen.getByRole('button', { name: 'Analyze pattern' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toBeEnabled();
  });

  it('refuses the click while it is unavailable', async () => {
    const onAnalyze = vi.fn();
    const user = userEvent.setup();
    render(
      <AnalyzeAction submission={idle} busy={false} onAnalyze={onAnalyze} subject="pattern" />,
    );

    await user.click(screen.getByRole('button', { name: 'Analyze pattern' }));
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it('is disabled when the visible result already describes the editor', () => {
    // Re-submitting identical text spends a worker round trip to arrive back
    // where it started.
    render(
      <AnalyzeAction submission={settled} busy={false} onAnalyze={vi.fn()} subject="pattern" />,
    );
    expect(screen.getByRole('button', { name: 'Analyze pattern' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('is available once there is something new to submit', () => {
    render(<AnalyzeAction submission={ready} busy={false} onAnalyze={vi.fn()} subject="pattern" />);
    const button = screen.getByRole('button', { name: 'Analyze pattern' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('keeps focus when it becomes unavailable', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AnalyzeAction submission={ready} busy={false} onAnalyze={vi.fn()} subject="pattern" />,
    );
    await user.tab();
    const button = screen.getByRole('button', { name: 'Analyze pattern' });
    expect(button).toHaveFocus();

    // The state a successful analysis leaves behind.
    rerender(
      <AnalyzeAction submission={settled} busy={false} onAnalyze={vi.fn()} subject="pattern" />,
    );
    expect(screen.getByRole('button', { name: 'Analyze pattern' })).toHaveFocus();
  });

  it('submits once per click and cannot be double-fired while busy', async () => {
    const onAnalyze = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <AnalyzeAction submission={ready} busy={false} onAnalyze={onAnalyze} subject="pattern" />,
    );

    await user.click(screen.getByRole('button', { name: 'Analyze pattern' }));
    expect(onAnalyze).toHaveBeenCalledTimes(1);

    rerender(<AnalyzeAction submission={ready} busy onAnalyze={onAnalyze} subject="pattern" />);
    const busyButton = screen.getByRole('button', { name: 'Analyze pattern' });
    expect(busyButton).toHaveAttribute('aria-disabled', 'true');
    // Focus is not thrown away mid-interaction.
    expect(busyButton).toBeEnabled();
    await user.click(busyButton);
    expect(onAnalyze).toHaveBeenCalledTimes(1);
  });

  it('works from the keyboard', async () => {
    const onAnalyze = vi.fn();
    const user = userEvent.setup();
    render(
      <AnalyzeAction submission={ready} busy={false} onAnalyze={onAnalyze} subject="pattern" />,
    );

    await user.tab();
    await user.keyboard('{Enter}');
    expect(onAnalyze).toHaveBeenCalledTimes(1);
  });

  it('says it is working, in text rather than only in a spinner', () => {
    render(<AnalyzeAction submission={ready} busy onAnalyze={vi.fn()} subject="pattern" />);
    expect(screen.getByRole('button', { name: 'Analyze pattern' })).toHaveTextContent('Analyzing');
  });

  it('marks unanalyzed changes in words beside the button', () => {
    render(<AnalyzeAction submission={stale} busy={false} onAnalyze={vi.fn()} subject="pattern" />);
    expect(screen.getByText('Unanalyzed changes')).toBeInTheDocument();
  });

  it('says nothing about staleness before anything has been analysed', () => {
    render(<AnalyzeAction submission={ready} busy={false} onAnalyze={vi.fn()} subject="pattern" />);
    expect(screen.queryByText('Unanalyzed changes')).not.toBeInTheDocument();
  });

  it('announces the stale and busy states politely', () => {
    const { rerender, container } = render(
      <AnalyzeStatus submission={stale} busy={false} subject="pattern" />,
    );
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent(/have not been analyzed/i);

    rerender(<AnalyzeStatus submission={stale} busy subject="pattern" />);
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(/Analyzing pattern/i);
  });
});
