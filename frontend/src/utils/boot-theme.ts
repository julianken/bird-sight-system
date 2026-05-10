/**
 * Theme boot logic — resolves the initial [data-theme] value before first
 * paint to prevent FOUC.
 *
 * Mirrors the inline blocking script in index.html. The inline script is
 * load-bearing (must execute before first paint, can't be a deferred
 * module), so it duplicates this logic verbatim. This module exists so
 * the resolution rules are unit-testable; any change to the rules MUST
 * be applied in both places.
 *
 * Resolution order:
 *   1. localStorage['theme']  → 'light' | 'dark' (explicit user preference)
 *   2. prefers-color-scheme   → OS-level preference fallback
 *   3. 'light'                → safe default when both sources fail
 *
 * Both localStorage access and matchMedia access can throw:
 *   - localStorage throws SecurityError in Safari Private Browsing and
 *     in sandboxed iframes that disallow storage.
 *   - matchMedia is undefined in older test environments.
 *
 * Storage failures are non-fatal — the theme falls through to the OS
 * preference (or 'light' as last resort), and the in-session [data-theme]
 * attribute remains the source of truth until the next page load.
 *
 * Spec: docs/design/01-spec/tokens.md §Light/dark mechanic
 */

export type Theme = 'light' | 'dark';

export function resolveInitialTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem('theme');
  } catch {
    // SecurityError (Safari Private Browsing, sandboxed iframe) — fall
    // through to the prefers-color-scheme branch.
  }

  if (stored === 'dark' || stored === 'light') {
    return stored;
  }

  try {
    if (
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
  } catch {
    // matchMedia rarely throws but is defensively wrapped — fall through.
  }

  return 'light';
}

export function applyInitialTheme(): Theme {
  const theme = resolveInitialTheme();
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}
