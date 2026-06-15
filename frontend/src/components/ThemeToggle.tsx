import { useState, useCallback, useRef } from 'react';
import { applyTheme, type Theme } from '../utils/boot-theme.js';
import type { ThemeId } from '@/components/map/geometry/basemap-style.js';

function readCurrentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

// The two themes reachable through the toggle (C7): the light/dark polarity it
// flips between maps to these ids. The selector (C8) replaces this binary with
// the full registry; until then the toggle is light↔dark = positron↔dark.
const POLARITY_TO_ID: Record<Theme, ThemeId> = {
  light: 'positron',
  dark: 'dark',
};

/**
 * ThemeToggle — header button that flips the chrome polarity light↔dark.
 *
 * Routes its click through the single `applyTheme` write path (boot-theme.ts):
 * it maps the next polarity to a ThemeId (positron↔dark), and `applyTheme`
 * derives `[data-theme]` from that descriptor's kind and persists the ID under
 * localStorage['theme'] (read on next load by the inline blocking script in
 * index.html). C8 may replace this toggle with the full theme selector; until
 * then it shares the ONE write path so chrome + basemap stay in lockstep.
 *
 * The MutationObserver in `useStateArtboard` observes data-theme changes and
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
 * Spec: docs/design/01-spec/architecture.md §Persistent chrome — Epic #1221 (C7 · #1219)
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readCurrentTheme);
  const liveRef = useRef<HTMLSpanElement | null>(null);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    // Single write path: applyTheme resolves the descriptor, writes
    // [data-theme] from its kind (== `next` here, positron→light / dark→dark),
    // and persists the id. Storage failures are swallowed inside applyTheme.
    applyTheme(POLARITY_TO_ID[next]);
    // Announce the new theme to screen readers via the sibling live region
    // (NOT via aria-live on the button — see #416).
    if (liveRef.current) {
      liveRef.current.textContent = next === 'dark' ? 'Dark theme' : 'Light theme';
    }
    setTheme(next);
  }, [theme]);

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle color theme"
        aria-pressed={theme === 'dark'}
        className="theme-toggle"
      >
        {/* Recipe #09 — icon-swap: two stacked glyph spans occupy one slot.
            The visible span has data-active; the hidden span is the outgoing
            glyph. CSS cross-fades opacity+blur+scale on [data-active] via a
            transition — the global motion.css guard zeros the duration for
            reduced-motion users, leaving glyphs at their end-state (visible
            active glyph) with no sticking. */}
        <span
          className="theme-toggle-glyph"
          data-active={theme === 'light' ? true : undefined}
          aria-hidden="true"
        >
          ☀
        </span>
        <span
          className="theme-toggle-glyph"
          data-active={theme === 'dark' ? true : undefined}
          aria-hidden="true"
        >
          ☾
        </span>
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
