import React from 'react';

export interface ErrorBoundaryProps {
  /** Fallback UI rendered when a child throws during render. */
  fallback?: React.ReactNode;
  /**
   * O7 (#786) — reset affordance. When any element of this array changes
   * (shallow comparison with the previous render), the boundary clears its
   * error state and re-mounts the children. Mirrors the `resetKeys` pattern
   * from react-error-boundary and the React docs recommendation for WebGL
   * context-loss recovery: the parent can bump a key to trigger a re-attempt
   * without a full page reload.
   *
   * MapSurface passes `[glRetryKey]` — a local useState counter bumped by its
   * custom fallback's "Try again" button — so clicking "Try again" re-mounts
   * the Suspense/MapCanvas GL subtree in-place without a full page reload.
   */
  resetKeys?: unknown[];
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  /** Internal counter bumped by the "Try again" button to trigger a reset. */
  retryCount: number;
}

/**
 * Generic React error boundary. Catches render-phase errors in the subtree
 * and displays a fallback instead of crashing the entire app.
 *
 * Used by MapSurface to isolate MapLibre GL JS failures (WebGL context loss,
 * tile fetch errors, style parse errors) from the rest of the application.
 *
 * O7 (#786): added `resetKeys` prop for re-attemptable recovery without a
 * full page reload. A shallow change in `resetKeys` (any element differs)
 * clears `hasError`/`error` on the next render, re-mounting the children.
 * Also adds a "Try again" button to the default `.error-screen` fallback
 * that bumps an internal retry counter (same effect as a resetKeys change).
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /** Snapshot of resetKeys from the previous render for shallow comparison. */
  private prevResetKeys: unknown[] | undefined;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
    this.prevResetKeys = props.resetKeys ? [...props.resetKeys] : undefined;
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  /**
   * O7 (#786): check for resetKeys changes. If any element in `resetKeys`
   * differs from the previous render, clear the error state so the children
   * re-mount. Called on every render (getDerivedStateFromProps runs before
   * render but cannot read instance vars — we use componentDidUpdate instead).
   */
  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (!this.state.hasError) {
      this.prevResetKeys = this.props.resetKeys ? [...this.props.resetKeys] : undefined;
      return;
    }
    const nextKeys = this.props.resetKeys;
    const prevKeys = prevProps.resetKeys;
    if (!nextKeys || !prevKeys) return;
    if (nextKeys.length !== prevKeys.length) {
      this.setState({ hasError: false, error: null });
      this.prevResetKeys = [...nextKeys];
      return;
    }
    for (let i = 0; i < nextKeys.length; i++) {
      if (nextKeys[i] !== prevKeys[i]) {
        this.setState({ hasError: false, error: null });
        this.prevResetKeys = [...nextKeys];
        return;
      }
    }
  }

  handleRetry(): void {
    this.setState(s => ({ hasError: false, error: null, retryCount: s.retryCount + 1 }));
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback != null) return this.props.fallback;
      return (
        <div className="error-screen" role="alert">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message ?? 'An unexpected error occurred.'}</p>
          <button
            type="button"
            className="error-screen__retry"
            onClick={this.handleRetry}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
