import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function Explode(): React.JSX.Element {
  throw new Error('deliberate test failure');
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary scope="app">
        <p>content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('catches a render failure and announces it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary scope="analysis">
        <Explode />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('tells an analysis-panel user their input is preserved', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary scope="analysis">
        <Explode />
      </ErrorBoundary>,
    );

    // The whole point of the inner boundaries: a crash must never cost the
    // user their input, and the copy must say so.
    expect(screen.getByText(/input has been preserved/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('offers panel-level recovery rather than a reload for inner scopes', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary scope="input">
        <Explode />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Reset this panel' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('offers a reload for the app scope', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary scope="app">
        <Explode />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Reload SyntaxLab' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('recovers the panel when reset is pressed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();

    function Flaky({ shouldThrow }: { shouldThrow: boolean }): React.JSX.Element {
      if (shouldThrow) throw new Error('deliberate test failure');
      return <p>recovered</p>;
    }

    function Harness(): React.JSX.Element {
      return (
        <ErrorBoundary scope="input">
          <Flaky shouldThrow={false} />
        </ErrorBoundary>
      );
    }

    const { rerender } = render(
      <ErrorBoundary scope="input">
        <Flaky shouldThrow />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Reset this panel' }));
    rerender(<Harness />);

    expect(screen.getByText('recovered')).toBeInTheDocument();
    spy.mockRestore();
  });
});
