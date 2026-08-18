import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

/**
 * Error boundary — 10_COMPONENT_ARCHITECTURE.md §2
 *
 * Three instances are placed deliberately rather than sprinkled:
 *   app       — full-page recovery
 *   input     — a crash here must not cost the analysis pane
 *   analysis  — a crash here must not cost the user's input
 *
 * The point of the two inner boundaries is that a rendering crash never
 * destroys the user's input, which is the only thing in this application that
 * cannot be recomputed.
 *
 * Class component because React provides no hook equivalent of
 * componentDidCatch. This is the one sanctioned class in the codebase
 * (18_CODING_STANDARDS.md §5.1).
 */

export type BoundaryScope = 'app' | 'input' | 'analysis';

interface Props {
  readonly scope: BoundaryScope;
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
}

const SCOPE_COPY: Readonly<Record<BoundaryScope, { title: string; body: string }>> = {
  app: {
    title: 'Something went wrong',
    body: 'SyntaxLab hit an unexpected error and could not continue. Your work is not saved automatically at this point, so reloading will start a fresh session.',
  },
  input: {
    title: 'The editor stopped responding',
    body: 'This panel hit an unexpected error. The rest of SyntaxLab is still working — you can reset just this panel.',
  },
  analysis: {
    title: 'The analysis panel stopped responding',
    body: 'This panel hit an unexpected error. Your input has been preserved. Resetting this panel will re-run the analysis.',
  },
};

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Development-only diagnostics. Production must never surface a stack
    // trace or user content (05_SECURITY.md §11, 18_CODING_STANDARDS.md S7).
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console -- dev-only diagnostic channel
      console.error(`[SyntaxLab] ${this.props.scope} boundary caught:`, error, info.componentStack);
    }
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null });
  };

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    const { scope, children } = this.props;

    if (!error) return children;

    const copy = SCOPE_COPY[scope];
    const isApp = scope === 'app';

    return (
      <div className={isApp ? styles.fullPage : styles.panel} role="alert">
        <div className={styles.content}>
          <h2 className={styles.title}>{copy.title}</h2>
          <p className={styles.body}>{copy.body}</p>

          {import.meta.env.DEV && (
            <pre className={styles.diagnostic}>
              {error.name}: {error.message}
            </pre>
          )}

          <div className={styles.actions}>
            {isApp ? (
              <button type="button" className={styles.button} onClick={this.handleReload}>
                Reload SyntaxLab
              </button>
            ) : (
              <button type="button" className={styles.button} onClick={this.handleReset}>
                Reset this panel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
