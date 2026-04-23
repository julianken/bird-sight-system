import React from 'react';

export interface ErrorBoundaryProps {
  /** Fallback UI rendered when a child throws during render. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Generic React error boundary. Catches render-phase errors in the subtree
 * and displays a fallback instead of crashing the entire app.
 *
 * Used by MapSurface to isolate MapLibre GL JS failures (WebGL context loss,
 * tile fetch errors, style parse errors) from the rest of the application.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback != null) return this.props.fallback;
      return (
        <div className="error-screen" role="alert">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message ?? 'An unexpected error occurred.'}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
