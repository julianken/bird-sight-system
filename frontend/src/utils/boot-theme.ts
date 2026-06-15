/**
 * Theme boot + apply logic — resolves the initial theme id before first
 * paint to prevent FOUC, and owns the single `applyTheme` write path that
 * derives `[data-theme]` (chrome polarity) from the active descriptor's kind.
 *
 * Mirrors the inline blocking script in index.html. The inline script is
 * load-bearing (must execute before first paint, can't be a deferred
 * module), so it duplicates the RESOLUTION logic verbatim — including the
 * id→kind lookup. This module exists so the resolution rules are
 * unit-testable; any change to the rules MUST be applied in both places, and
 * `ID_TO_KIND` below is the map the inline script duplicates (a test imports
 * both and asserts equality so they can never drift).
 *
 * The active THEME ID is the source of truth (C1.5 · #1213): `[data-theme]`
 * is DERIVED from `resolveDescriptor(id).kind`. The persisted value lives under
 * `localStorage['theme']` and is now the ID (`'positron'`, `'dark'`, …), with a
 * back-compat shim that maps the legacy `'light'`/`'dark'` chrome values to the
 * `'positron'`/`'dark'` ids on the READ path only — so existing users keep
 * their choice across the key-value change.
 *
 * Resolution order (`resolveInitialTheme`):
 *   1. localStorage['theme']  → a known ThemeId, OR a legacy 'dark' value (and
 *                               the legacy chrome value 'light', now mapped to
 *                               'bright') via the back-compat shim.
 *   2. prefers-color-scheme   → 'dark' when the OS prefers dark.
 *   3. 'bright'               → the light default (C8 · #1220 flipped this from
 *                               'positron' to 'bright' per Julian's directive;
 *                               'bright' is light-kind so [data-theme] stays
 *                               'light' — only the resolved id + basemap change).
 *
 * Both localStorage access and matchMedia access can throw:
 *   - localStorage throws SecurityError in Safari Private Browsing and
 *     in sandboxed iframes that disallow storage.
 *   - matchMedia is undefined in older test environments.
 *
 * Storage failures are non-fatal — the theme falls through to the OS
 * preference (or the bright default), and the in-session [data-theme]
 * attribute remains the chrome source of truth until the next page load.
 *
 * Spec: docs/design/01-spec/tokens.md §Light/dark mechanic
 * Epic #1221 (C7 · #1219).
 */

import {
  THEME_REGISTRY,
  resolveDescriptor,
  type ThemeId,
  type BasemapDescriptor,
  type BasemapKind,
} from '@/components/map/geometry/basemap-style.js';

/**
 * Chrome polarity. `[data-theme]` only ever holds one of these two values —
 * it is DERIVED from the active descriptor's `kind`. Re-exported (and re-used
 * by `use-theme.ts`, which reads the derived attribute) as the canonical
 * polarity type. Distinct from `ThemeId`, which names a specific basemap style.
 */
export type Theme = BasemapKind;

/** The `localStorage` key the persisted theme id lives under (legacy key, kept). */
export const THEME_STORAGE_KEY = 'theme';

/** The known theme ids — derived from the registry so it can never go stale. */
const KNOWN_THEME_IDS = Object.keys(THEME_REGISTRY) as ThemeId[];

/**
 * id → kind map. The single source of truth is `THEME_REGISTRY` (each
 * descriptor's `kind`); this is the flattened lookup the chrome boot path
 * needs. The inline blocking `<script>` in index.html DUPLICATES this object
 * literal verbatim (it cannot import the module) — `boot-theme.test.ts` imports
 * BOTH and asserts equality so they can never drift.
 */
export const ID_TO_KIND: Record<ThemeId, BasemapKind> = Object.fromEntries(
  KNOWN_THEME_IDS.map((id) => [id, THEME_REGISTRY[id].kind]),
) as Record<ThemeId, BasemapKind>;

/** Type guard: is `value` a registered `ThemeId`? */
function isThemeId(value: string | null): value is ThemeId {
  return value !== null && Object.prototype.hasOwnProperty.call(ID_TO_KIND, value);
}

/**
 * Back-compat shim (READ path only): map a persisted value to a `ThemeId`.
 * Returns a known id unchanged; maps the legacy chrome values `'light'` →
 * `'bright'` (C8 · #1220 — the light default) and `'dark'` → the `'dark'` id;
 * returns `null` for anything unrecognized so the caller falls through to OS
 * preference / default.
 */
function persistedToThemeId(value: string | null): ThemeId | null {
  if (isThemeId(value)) return value;
  if (value === 'light') return 'bright'; // legacy chrome value → bright id (C8 default flip)
  if (value === 'dark') return 'dark'; // legacy chrome value → dark id (id === kind)
  return null;
}

/**
 * Resolve the initial active `ThemeId` before first paint.
 *
 *   1. persisted `localStorage['theme']` (known id, or legacy 'light'→'bright' /
 *      'dark' via the back-compat shim);
 *   2. `prefers-color-scheme: dark` → the `'dark'` id;
 *   3. `'bright'` — the light default (C8 · #1220 flipped this from 'positron').
 */
export function resolveInitialTheme(): ThemeId {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // SecurityError (Safari Private Browsing, sandboxed iframe) — fall
    // through to the prefers-color-scheme branch.
  }

  const fromStorage = persistedToThemeId(stored);
  if (fromStorage !== null) return fromStorage;

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

  return 'bright'; // C8 · #1220 — light default flipped from 'positron' to 'bright'.
}

/**
 * The single theme write path (C7 · #1219). Used by the toggle (C7) and the
 * selector (C8): resolves the descriptor, writes `[data-theme]` from its
 * `kind`, and persists the ID under `localStorage['theme']`. Returns the
 * resolved descriptor so callers can drive the id-keyed basemap swap.
 *
 * The active-theme-id React state (`useActiveThemeId`, C1.5) reads the derived
 * `[data-theme]` via its mount seed + the belt MutationObserver, so writing the
 * attribute here keeps the basemap swap in lockstep without a setter injection.
 */
export function applyTheme(id: ThemeId): BasemapDescriptor {
  const descriptor = resolveDescriptor(id);
  document.documentElement.setAttribute('data-theme', descriptor.kind);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Storage failures (Safari Private Browsing, sandboxed iframe, quota
    // exceeded) are non-fatal — [data-theme] is the in-session source of
    // truth; the only loss is persistence across reloads.
  }
  return descriptor;
}

/**
 * Resolve the initial id and write `[data-theme]` from its descriptor kind
 * before first paint. Does NOT persist (the resolved value may BE the persisted
 * value, or an OS/default fallback that should not overwrite an empty store).
 * Returns the resolved id.
 */
export function applyInitialTheme(): ThemeId {
  const id = resolveInitialTheme();
  document.documentElement.setAttribute('data-theme', ID_TO_KIND[id]);
  return id;
}
