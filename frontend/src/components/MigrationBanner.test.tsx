import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MigrationBanner, readMigrationFlag } from './MigrationBanner.js';

describe('readMigrationFlag', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('returns true when ?region= is present in the URL', () => {
    window.history.replaceState({}, '', '/?region=sky-islands');
    expect(readMigrationFlag()).toBe(true);
  });

  it('returns false when ?region= is absent from the URL', () => {
    window.history.replaceState({}, '', '/');
    expect(readMigrationFlag()).toBe(false);
  });
});

describe('MigrationBanner', () => {
  beforeEach(() => {
    vi.spyOn(window.history, 'replaceState');
    window.history.replaceState({}, '', '/?region=sky-islands');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('renders with role=status when readMigrationFlag() is true', () => {
    render(<MigrationBanner show />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The region view has been replaced'
    );
  });

  it('returns null when show is false', () => {
    const { container } = render(<MigrationBanner show={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('dismiss button hides the banner', () => {
    render(<MigrationBanner show />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss migration notice' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('dismiss calls window.history.replaceState with a URL lacking region=', () => {
    render(<MigrationBanner show />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss migration notice' }));
    // Last replaceState call must not include region=
    const calls = (window.history.replaceState as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls.at(-1);
    const urlArg = lastCall?.[2] as string;
    expect(urlArg).not.toContain('region=');
  });

  it('dismiss button has type="button" to prevent form submission', () => {
    render(<MigrationBanner show />);
    const btn = screen.getByRole('button', { name: 'Dismiss migration notice' });
    expect(btn).toHaveAttribute('type', 'button');
  });
});
