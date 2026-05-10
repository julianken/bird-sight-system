import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle.js';

function setTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

function getTheme(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    setTheme('light');
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders a button', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('displays sun icon (☀) when theme is light', () => {
    setTheme('light');
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveTextContent('☀');
  });

  it('displays moon icon (☾) when theme is dark', () => {
    setTheme('dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveTextContent('☾');
  });

  it('toggles from light to dark on click', async () => {
    setTheme('light');
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button'));
    expect(getTheme()).toBe('dark');
  });

  it('toggles from dark to light on click', async () => {
    setTheme('dark');
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button'));
    expect(getTheme()).toBe('light');
  });

  it('persists the new theme to localStorage on click', async () => {
    setTheme('light');
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button'));
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('has an accessible aria-label that names the target theme', () => {
    setTheme('light');
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-label',
      'Switch to dark theme',
    );
  });

  it('aria-label updates after toggle', async () => {
    setTheme('light');
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-label',
      'Switch to light theme',
    );
  });

  it('button has no aria-live attribute (fix #416 — live region is a sibling)', () => {
    setTheme('light');
    render(<ThemeToggle />);
    const btn = screen.getByRole('button');
    expect(btn).not.toHaveAttribute('aria-live');
  });

  it('sibling live region announces the new theme name after toggle', async () => {
    setTheme('light');
    const { container } = render(<ThemeToggle />);
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
    // Before toggle, live region is empty
    expect(liveRegion?.textContent).toBe('');
    await userEvent.click(screen.getByRole('button'));
    // After toggle to dark, live region announces "Dark theme"
    expect(liveRegion?.textContent).toBe('Dark theme');
  });

  // Safari Private Browsing and sandboxed iframes throw SecurityError on
  // localStorage writes. The toggle MUST swallow the error and still
  // update [data-theme] (the in-session source of truth) — only the
  // cross-reload persistence is forfeit.
  it('does not crash and still updates [data-theme] when localStorage.setItem throws SecurityError', async () => {
    setTheme('light');
    document.documentElement.setAttribute('data-theme', 'light');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });

    render(<ThemeToggle />);

    await expect(
      userEvent.click(screen.getByRole('button')),
    ).resolves.not.toThrow();

    expect(getTheme()).toBe('dark');
  });
});
