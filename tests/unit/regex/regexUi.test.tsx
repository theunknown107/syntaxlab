import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SourceSpan } from '@/domain/shared/result';
import { analyzeRegex } from '@/domain/regex/analyze';
import { executeRegex, type RegexExecResult } from '@/domain/regex/execute';
import { ExplanationView, type SpanLinkHandlers } from '@/features/regex/ExplanationView';
import { FlagBar } from '@/features/regex/FlagBar';
import { MatchResults } from '@/features/regex/MatchResults';
import { WarningList } from '@/features/regex/RegexPanels';
import { Panel } from '@/components/primitives/Panel';

/**
 * Component tests, queried by role and accessible name.
 *
 * Never by test id or class: a component that cannot be found by its
 * accessible name has an accessibility bug, and the query failing is the
 * report (10_COMPONENT_ARCHITECTURE.md §8).
 */

const links: SpanLinkHandlers = { onHover: vi.fn(), onSelect: vi.fn() };

/** Typed spies, so an assertion reads the span rather than an `any`. */
const spanSpy = () => vi.fn<(span: SourceSpan) => void>();
const hoverSpy = () => vi.fn<(span: SourceSpan | null) => void>();

function analyse(source: string, flags = '') {
  const result = analyzeRegex({ source, flags });
  if (!result.ok) throw new Error('analysis failed');
  return result.value;
}

function execute(source: string, flags: string, subject: string): RegexExecResult {
  const result = executeRegex({ source, flags, subject });
  if (!result.ok) throw new Error('exec failed');
  return result.value;
}

const READY = {
  status: 'ready',
  error: null,
  hasPattern: true,
  hasSubject: true,
  patternIsValid: true,
} as const;

describe('ExplanationView', () => {
  it('renders the summary as readable prose', () => {
    render(<ExplanationView explanation={analyse('^a+$').explanation} links={links} />);
    expect(screen.getAllByText(/start of the string/).length).toBeGreaterThan(0);
  });

  it('renders user syntax as text, never as markup', () => {
    // The highest-frequency operation in the product quotes the user's own
    // input. This is the assertion that the quoting path has no HTML sink.
    const { container } = render(
      <ExplanationView explanation={analyse('<img src=x onerror=y>').explanation} links={links} />,
    );

    // Asserted against the DOM rather than a serialised string: the claim is
    // that no unexpected element was created, and the element list says that
    // directly.
    const tags = new Set([...container.querySelectorAll('*')].map((el) => el.tagName));
    expect(tags.has('IMG')).toBe(false);
    expect(tags.has('SCRIPT')).toBe(false);
    expect(
      [...tags].every((tag) =>
        ['DIV', 'P', 'OL', 'LI', 'SPAN', 'CODE', 'EM', 'BUTTON', 'UL'].includes(tag),
      ),
    ).toBe(true);

    // The payload is present — as text. The explanation reads a literal
    // character by character, so only the individual characters appear, which
    // is exactly why nothing here can become markup.
    expect(container.textContent).toContain('<');
    expect(container.textContent).toContain('>');
  });

  it('links each explained construct back to its position in the source', async () => {
    const user = userEvent.setup();
    const onSelect = spanSpy();
    render(
      <ExplanationView
        explanation={analyse('(a)(b)').explanation}
        links={{ onHover: vi.fn(), onSelect }}
      />,
    );

    const refs = screen.getAllByRole('button');
    expect(refs.length).toBeGreaterThan(0);

    await user.click(refs[0]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(typeof onSelect.mock.calls[0]?.[0]?.start).toBe('number');
  });

  it('names each link with its position for a screen reader', () => {
    render(<ExplanationView explanation={analyse('a+').explanation} links={links} />);
    expect(
      screen.getAllByRole('button', { name: /at position \d+ in the pattern/ }).length,
    ).toBeGreaterThan(0);
  });

  it('highlights the source span on hover and clears it on leave', async () => {
    const user = userEvent.setup();
    const onHover = hoverSpy();
    render(
      <ExplanationView
        explanation={analyse('a+').explanation}
        links={{ onHover, onSelect: vi.fn() }}
      />,
    );

    const link = screen.getAllByRole('button')[0]!;
    await user.hover(link);
    expect(typeof onHover.mock.calls.at(-1)?.[0]?.start).toBe('number');

    await user.unhover(link);
    expect(onHover.mock.calls.at(-1)?.[0]).toBeNull();
  });
});

describe('MatchResults', () => {
  it('presents no matches neutrally, not as a failure', () => {
    render(<MatchResults {...READY} result={execute('z', 'g', 'abc')} />);

    expect(screen.getByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the count, the matched text and the groups', () => {
    render(<MatchResults {...READY} result={execute('(\\w)(\\d)', 'g', 'a1 b2')} />);

    expect(screen.getByText('2 matches')).toBeInTheDocument();
    expect(screen.getByText('a1')).toBeInTheDocument();
    expect(screen.getByText('b2')).toBeInTheDocument();
  });

  it('distinguishes a group that did not participate from one that matched empty', () => {
    render(<MatchResults {...READY} result={execute('(a)|(b)', '', 'b')} />);
    expect(screen.getByText('did not participate')).toBeInTheDocument();
  });

  it('labels a zero-length match rather than showing a blank cell', () => {
    render(<MatchResults {...READY} result={execute('x*', 'g', 'ab')} />);
    expect(screen.getAllByText('empty match').length).toBeGreaterThan(0);
  });

  it('says the g flag is off rather than silently showing one result', () => {
    render(<MatchResults {...READY} result={execute('a', '', 'aaa')} />);
    expect(screen.getByText(/Turn on the/)).toBeInTheDocument();
  });

  it('states plainly that results were truncated', () => {
    const truncated: RegexExecResult = { ...execute('a', 'g', 'aaa'), truncated: 'matchCount' };
    render(<MatchResults {...READY} result={truncated} />);

    // "Do not silently discard matches" — the notice names what happened and
    // how many are shown.
    expect(screen.getByText(/Showing the first 3 matches/)).toBeInTheDocument();
  });

  it('names the size limit when that is what stopped the scan', () => {
    const truncated: RegexExecResult = { ...execute('a', 'g', 'aaa'), truncated: 'outputSize' };
    render(<MatchResults {...READY} result={truncated} />);
    expect(screen.getByText(/exceeded the size limit/)).toBeInTheDocument();
  });

  it('reports a timeout as an alert, without blaming the pattern', () => {
    render(
      <MatchResults
        {...READY}
        status="timeout"
        result={null}
        error={{ message: 'Execution timed out after 2 seconds.', hint: 'The worker was stopped.' }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Execution timed out after 2 seconds.');
    expect(screen.queryByText(/malicious/i)).toBeNull();
  });

  it('explains why testing is unavailable and what still works', () => {
    render(<MatchResults {...READY} status="unavailable" result={null} />);

    expect(screen.getByText(/could not start a Web Worker/)).toBeInTheDocument();
    // The security invariant, stated to the user rather than only in a comment.
    expect(screen.getByText(/not moved onto the page's own thread/)).toBeInTheDocument();
  });

  it('pauses the tester when the pattern does not parse', () => {
    render(<MatchResults {...READY} patternIsValid={false} result={null} />);
    expect(screen.getByText('Pattern is not valid')).toBeInTheDocument();
  });

  it('prompts for the missing half of the input', () => {
    const { rerender } = render(<MatchResults {...READY} hasPattern={false} result={null} />);
    expect(screen.getByText('Enter a pattern to test it.')).toBeInTheDocument();

    rerender(<MatchResults {...READY} hasSubject={false} result={null} />);
    expect(screen.getByText('Enter a test string to see matches.')).toBeInTheDocument();
  });
});

describe('FlagBar', () => {
  it('reports each flag state with aria-pressed', () => {
    render(<FlagBar flags="gi" onToggle={vi.fn()} onReset={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Global/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Sticky/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('describes what each flag does, not only its letter', () => {
    render(<FlagBar flags="" onToggle={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Find every match/ })).toBeInTheDocument();
  });

  it('toggles through the callback rather than holding its own state', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<FlagBar flags="" onToggle={onToggle} onReset={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Multiline/ }));
    expect(onToggle).toHaveBeenCalledWith('m');
  });

  it('explains the u/v exclusion when one of them is on', () => {
    const { rerender } = render(<FlagBar flags="g" onToggle={vi.fn()} onReset={vi.fn()} />);
    expect(screen.queryByText(/cannot be\s+combined/)).toBeNull();

    rerender(<FlagBar flags="gu" onToggle={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByText(/cannot be/)).toBeInTheDocument();
  });
});

describe('WarningList', () => {
  it('labels severity in text as well as colour', () => {
    const analysis = analyse('(a+)+b');
    render(<WarningList warnings={analysis.warnings} errors={[]} links={links} />);

    expect(screen.getByText('May be slow')).toBeInTheDocument();
  });

  it('puts errors before warnings', () => {
    const analysis = analyse('(a+)+b');
    render(
      <WarningList
        warnings={analysis.warnings}
        errors={[{ code: 'SYNTAX', message: 'Something is wrong.' }]}
        links={links}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Something is wrong.');
  });

  it('offers a jump to the position a warning refers to', async () => {
    const user = userEvent.setup();
    const onSelect = spanSpy();
    const analysis = analyse('(a+)+b');
    render(
      <WarningList
        warnings={analysis.warnings}
        errors={[]}
        links={{ onHover: vi.fn(), onSelect }}
      />,
    );

    await user.click(screen.getAllByRole('button', { name: /Show at/ })[0]!);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('Panel', () => {
  it('keeps its heading when it is collapsible', () => {
    // A collapsible section is still part of the document outline. Rendering
    // the title as a bare button removes it from the structure a screen-reader
    // user navigates by — found by axe during M4.
    render(
      <Panel title="Structure" collapsible>
        <p>body</p>
      </Panel>,
    );

    const heading = screen.getByRole('heading', { name: /Structure/ });
    expect(within(heading).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses and expands from the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <Panel title="Tokens" collapsible>
        <p>body</p>
      </Panel>,
    );

    const toggle = screen.getByRole('button', { name: /Tokens/ });
    expect(screen.getByText('body')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('body')).toBeNull();
  });
});
