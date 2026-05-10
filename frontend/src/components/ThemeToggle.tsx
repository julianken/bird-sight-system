import { useState, useCallback } from 'react';

type Theme = 'light' | 'dark';

function readCurrentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

/**
 * ThemeToggle — header button that flips [data-theme] on <html>.
 *
 * Writes both localStorage['theme'] (for persistence across page loads,
 * read by the inline blocking script in index.html) and the attribute on
 * document.documentElement (so CSS responds immediately without a reload).
 *
 * The MutationObserver in MapCanvas.tsx observes data-theme changes and
 * swaps the basemap style accordingly — no prop-drilling needed.
 *
 * Spec: docs/design/01-spec/tokens.md §Light/dark mechanic
 * Spec: docs/design/01-spec/architecture.md §Persistent chrome
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readCurrentTheme);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    setTheme(next);
  }, [theme]);

  const icon  = theme === 'light' ? '☀' : '☾';
  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-live="polite"
    >
      {icon}
    </button>
  );
}
