import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { analyzeCron } from '@/domain/cron/analyze';
import type { CronAnalysis } from '@/domain/cron/ast';
import type { SpanLinkHandlers } from '@/components/ExplanationView';
import { AnalyzeAction, AnalyzeStatus } from '@/components/primitives/AnalyzeAction';
import { submissionOf } from '@/application/stores/workspaceStore';
import { LIMITS } from '@/domain/shared/limits';
import { previewSchedule, type CronSchedulePreview } from '@/domain/cron/schedule';
import { CronFields } from '@/features/cron/CronFields';
import { CronSchedule } from '@/features/cron/CronSchedule';
import { refreshCronSchedule } from '@/application/cron/cronWorkspace';

// The panel offers a Recalculate control; what is tested here is that it asks,
// not what the worker answers.
vi.mock('@/application/cron/cronWorkspace', () => ({ refreshCronSchedule: vi.fn() }));

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

/* ------------------------------------------------------------------ *
 * The next-run panel — M16
 * ------------------------------------------------------------------ */

/** A real preview, from the real engine. No hand-written fixtures. */
function preview(
  source: string,
  mode: 'browserLocal' | 'utc' = 'utc',
  after = Date.parse('2026-03-10T12:00:00Z'),
): CronSchedulePreview {
  const analysis = analyzeCron(source, { timezoneMode: mode });
  if (!analysis.ok) throw new Error(`expected ${source} to analyse`);
  return previewSchedule(analysis.value, { mode, after, count: LIMITS.cron.maxOccurrences });
}

function renderSchedule(value: CronSchedulePreview | null, overrides = {}): void {
  render(
    <CronSchedule
      preview={value}
      status="ready"
      failure={null}
      hasAnalysis={value !== null}
      {...overrides}
    />,
  );
}

describe('the next-run panel', () => {
  it('leads with the next run, as a date a person can read', () => {
    renderSchedule(preview('*/15 9-17 * * 1-5'));

    // 2026-03-10 is a Tuesday; the next quarter hour inside 09:00–17:00 UTC.
    expect(screen.getByText(/Next run/i)).toBeInTheDocument();
    expect(screen.getByText(/Tue 10 March 2026, 12:15/)).toBeInTheDocument();
  });

  it('lists the runs after it, capped rather than endless', () => {
    renderSchedule(preview('*/15 * * * *'));

    const upcoming = screen.getByRole('list', { name: /upcoming runs/i });
    // The cap counts the next run too, so the list holds one fewer.
    expect(within(upcoming).getAllByRole('listitem')).toHaveLength(LIMITS.cron.maxOccurrences - 1);
  });

  it('reads times in the mode that was asked for, not the browser zone', () => {
    // The regression this panel must never have: a UTC preview handed to
    // `toLocaleString` would be helpfully converted back into the reader's own
    // zone, which is the opposite of what the UTC mode is for. The wall clock
    // the domain matched is what gets rendered.
    renderSchedule(preview('0 0 * * *', 'utc'));
    expect(screen.getByText(/Wed 11 March 2026, 00:00/)).toBeInTheDocument();
    expect(screen.getAllByText(/UTC/).length).toBeGreaterThan(0);
  });

  it('says @reboot has no clock time rather than calling it invalid', () => {
    renderSchedule(preview('@reboot'));
    expect(screen.getByText(/no clock time/i)).toBeInTheDocument();
    expect(screen.queryByText(/Next run/i)).not.toBeInTheDocument();
  });

  it('says plainly when a schedule never comes round', () => {
    // 30 February is a date, syntactically. It is not a date, actually.
    renderSchedule(preview('0 0 30 2 *'));
    expect(screen.getByText(/no run in the next 5 years/i)).toBeInTheDocument();
  });

  it('marks a run the clocks skipped, and shows no time for it', () => {
    // Europe/London, 29 March 2026: 01:30 does not happen.
    const previousTz = process.env.TZ;
    process.env.TZ = 'Europe/London';
    try {
      renderSchedule(preview('30 1 * * *', 'browserLocal', Date.parse('2026-03-28T12:00:00Z')));
      expect(screen.getByText(/Clock skipped/i)).toBeInTheDocument();
      // It describes what schedulers do rather than picking one.
      expect(screen.getByText(/Most schedulers skip the run/i)).toBeInTheDocument();
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  it('marks a run that happens twice, and shows both offsets', () => {
    // Europe/London, 25 October 2026: 01:30 happens twice, BST then GMT.
    const previousTz = process.env.TZ;
    process.env.TZ = 'Europe/London';
    try {
      renderSchedule(preview('30 1 * * *', 'browserLocal', Date.parse('2026-10-24T12:00:00Z')));
      expect(screen.getByText(/Happens twice/i)).toBeInTheDocument();
      expect(screen.getByText('UTC+01:00')).toBeInTheDocument();
      expect(screen.getByText('UTC')).toBeInTheDocument();
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  it('says the times are calculated, not live', () => {
    renderSchedule(preview('0 0 * * *'));
    expect(screen.getByText(/Calculated at/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recalculate/i })).toBeInTheDocument();
  });

  it('recalculates on request rather than on a timer', async () => {
    const user = userEvent.setup();
    renderSchedule(preview('0 0 * * *'));

    await user.click(screen.getByRole('button', { name: /recalculate/i }));
    expect(refreshCronSchedule).toHaveBeenCalledTimes(1);
  });

  it('invites an analysis before there is one, rather than showing an empty list', () => {
    renderSchedule(null);
    expect(screen.getByText(/Analyze an expression/i)).toBeInTheDocument();
  });

  it('says it is working while the times are being calculated', () => {
    renderSchedule(preview('0 0 * * *'), { status: 'analyzing' });
    expect(screen.getByRole('status')).toHaveTextContent(/calculating/i);
  });

  it('shows a failure as an answer rather than an empty panel', () => {
    renderSchedule(preview('0 0 * * *'), {
      status: 'error',
      failure: { message: 'The analysis engine could not start in this browser.' },
    });
    expect(screen.getByRole('status')).toHaveTextContent(/could not start/i);
  });
});
