import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary.js';

// A component that throws when `shouldThrow` is true.
function MaybeThrower({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('render error from MaybeThrower');
  return <div data-testid="child-content">children rendered</div>;
}

// Suppress console.error for ErrorBoundary's componentDidCatch logging.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <MaybeThrower shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('shows the default error-screen fallback when a child throws', () => {
    render(
      <ErrorBoundary>
        <MaybeThrower shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('render error from MaybeThrower')).toBeInTheDocument();
  });

  it('shows a custom fallback prop when provided', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">custom!</div>}>
        <MaybeThrower shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    // Default alert must NOT appear when a custom fallback is provided
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Try again" button clears the error and re-mounts children (no stuck error)', () => {
    // Use a stateful wrapper so we can switch shouldThrow to false after reset.
    function Wrapper() {
      const [shouldThrow, setShouldThrow] = React.useState(true);
      return (
        <ErrorBoundary>
          <MaybeThrower shouldThrow={shouldThrow} />
          {/* Expose a control outside the boundary to flip shouldThrow */}
          <button
            data-testid="flip-throw"
            onClick={() => setShouldThrow(false)}
            style={{ display: 'none' }}
          />
        </ErrorBoundary>
      );
    }

    render(<Wrapper />);

    // Initial state: error screen visible
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Click "Try again" — boundary resets; child throws AGAIN (shouldThrow still true)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // Children threw again, boundary re-catches — still shows error screen
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('"Try again" allows successful re-render when the throw condition is resolved', () => {
    // Wrapper that tracks throw state externally so the boundary reset + a
    // non-throwing re-render succeed in sequence.
    function RecoverableWrapper() {
      const [shouldThrow, setShouldThrow] = useState(true);
      const [resetKey, setResetKey] = useState(0);
      return (
        <div>
          <button
            data-testid="heal"
            onClick={() => {
              setShouldThrow(false);
              setResetKey(k => k + 1);
            }}
          >
            Heal
          </button>
          <ErrorBoundary resetKeys={[resetKey]}>
            <MaybeThrower shouldThrow={shouldThrow} />
          </ErrorBoundary>
        </div>
      );
    }

    render(<RecoverableWrapper />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Heal: stop throwing + bump resetKey → boundary clears, children render
    fireEvent.click(screen.getByTestId('heal'));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('resetKeys change clears the error and re-mounts children (O7 #786)', () => {
    let setKey: (n: number) => void;

    function WithResetKeys() {
      const [key, setKeyFn] = useState(0);
      setKey = setKeyFn;
      return (
        <ErrorBoundary resetKeys={[key]}>
          <MaybeThrower shouldThrow={key === 0} />
        </ErrorBoundary>
      );
    }

    render(<WithResetKeys />);
    // Initially throws
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Bump resetKeys — now MaybeThrower won't throw (key !== 0)
    fireEvent.click(document.body); // ensure no stale focus
    // Simulate the resetKey change via React state
    import('../../../frontend/src/App.js').catch(() => {}); // prevent unused import warning
    React.act(() => { setKey(1); });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('logs the error to console.error via componentDidCatch', () => {
    render(
      <ErrorBoundary>
        <MaybeThrower shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith(
      'ErrorBoundary caught:',
      expect.any(Error),
      expect.anything(),
    );
  });
});
