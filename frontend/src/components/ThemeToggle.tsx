import { useState, useCallback, useRef } from 'react';

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
 * A11y (#416): the live-region is a visually-hidden <span> sibling to the
 * button (NOT a child of the button). ARIA live regions that are children
 * of interactive elements are ignored by some AT. The region is set
 * imperatively on toggle (imperative text update is more reliable than
 * React state-driven renders for live-region timing). The button itself
 * has NO aria-live — that's the fix.
 *
 * Spec: docs/design/01-spec/tokens.md §Light/dark mechanic
 * Spec: docs/design/01-spec/architecture.md §Persistent chrome
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readCurrentTheme);
  const liveRef = useRef<HTMLSpanElement | null>(null);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Storage failures (Safari Private Browsing, sandboxed iframe,
      // quota exceeded) are non-fatal — [data-theme] is the in-session
      // source of truth, the only loss is persistence across reloads.
    }
    // Announce the new theme to screen readers via the sibling live region
    // (NOT via aria-live on the button — see #416).
    if (liveRef.current) {
      liveRef.current.textContent = next === 'dark' ? 'Dark theme' : 'Light theme';
    }
    setTheme(next);
  }, [theme]);

  const icon  = theme === 'light' ? '☀' : '☾';
  const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
      >
        {icon}
      </button>
      {/* Visually-hidden live region — must be a SIBLING of the button,
          NOT a child. See #416. */}
      <span
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
        }}
      />
    </>
  );
}
