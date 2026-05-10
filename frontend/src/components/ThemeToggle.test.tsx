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

  it('has an accessible aria-label that names the current mode', () => {
    setTheme('light');
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-label',
      'Switch to dark mode',
    );
  });

  it('aria-label updates after toggle', async () => {
    setTheme('light');
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-label',
      'Switch to light mode',
    );
  });
});
