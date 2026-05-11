# Sky Atlas — Phase 1 Token Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the three-tier CSS token contract (primitive → semantic → component), wire `[data-theme]` light/dark with FOUC-free inline script, collapse the 35 hardcoded `font-size` literals in `styles.css` to a 6-step ramp, add the `frontend/src/config/region.ts` constant, build `ThemeToggle.tsx`, wire `MapCanvas.tsx` to swap basemap on theme change via `MutationObserver`, and add a CI lint guard that prevents forbidden mock token names from silently overwriting production CSS.

**Architecture:** All changes are frontend-only. `tokens.css` (new) establishes the three tiers without touching `tokens.ts` (JS token surface stays unchanged). `styles.css` is edited in-place: only `font-size` literals become token references — no visual values change. `index.html` gains an inline blocking script in `<head>`. `main.tsx` gains one CSS import. `MapCanvas.tsx` gains a `MutationObserver` that calls `map.setStyle()` on theme flip. The lint guard is a `grep` one-liner in CI (no stylelint install required — justification in Task 8).

**Tech Stack:** CSS custom properties, TypeScript, React 18, Vitest 4, `@testing-library/react`, MapLibre GL 5. Builds with Vite 8. No new npm dependencies.

**Requires Phase 0 merged.** The branch for this plan should be cut from `main` after Phase 0 is queued via Mergify.

---

## Quantified plan literals (implementer checklist)

Before opening a PR for this plan, check off each item or cite a deferral doc
with a lexically-matching subject (per R13 T7, issue #461):

- [ ] Ship 14 dark-mode token overrides in `[data-theme="dark"]` block (`tokens.css` Layer 2 dark section)
- [ ] Establish 3-tier token contract: primitive → semantic → component (all three tiers present in `tokens.css`)
- [ ] Migrate 35 hardcoded `font-size` literals in `styles.css` to type ramp tokens (`grep -c 'font-size: [0-9]' frontend/src/styles.css` returns `0`)
- [ ] 6-step type ramp declared: `--type-xs`, `--type-sm`, `--type-base`, `--type-md`, `--type-lg`, `--type-hero` (all 6 present in `tokens.css`)
- [ ] 8 ThemeToggle unit tests pass (toggle state, localStorage persistence, aria-label, aria-label update after toggle)
- [ ] 2 MapCanvas MutationObserver tests pass (setStyle called with correct URL on data-theme mutation to dark and to light)
- [ ] FOUC script: `grep -c 'data-theme' frontend/dist/index.html` returns ≥ 1
- [ ] Forbidden-token lint guard covers all named v3/v4 mock token names (accent, notable, bg-page, bg-surface, bg-tint, text-strong, text-body, text-muted, text-subtle, border)
- [ ] Zero remaining pixel `font-size` literals in `styles.css` after migration

---

## Spec reference

- Token system (three tiers, namespace migration table, type ramp, light/dark mechanic): `docs/design/01-spec/tokens.md`
- Architecture (surface system, `[data-theme]`, persistent chrome, `config/`): `docs/design/01-spec/architecture.md`
- Phase scope, dependencies, acceptance criteria: `docs/design/02-phases/phase-1-token-foundation.md`

---

## File structure

| File | Disposition | Responsibility |
|---|---|---|
| `frontend/src/styles/tokens.css` | Create | Three-tier token contract: primitives, semantic light/dark pairs, component aliases, type ramp |
| `frontend/src/styles/motion.css` | Already exists (Phase 0) | No change — imported correctly by `main.tsx` |
| `frontend/src/main.tsx` | Modify | Add `import './styles/tokens.css'` before `./styles.css` |
| `frontend/index.html` | Modify | Add inline blocking `<script>` in `<head>` to set `[data-theme]` pre-paint |
| `frontend/src/config/region.ts` | Create | `REGION_LABEL = 'Arizona'` — source of truth for wordmark + lede |
| `frontend/src/components/ThemeToggle.tsx` | Create | Header toggle button; writes `localStorage['theme']` + `document.documentElement.setAttribute` |
| `frontend/src/components/ThemeToggle.test.tsx` | Create | Unit tests for toggle state and localStorage persistence |
| `frontend/src/components/map/MapCanvas.tsx` | Modify | Add `MutationObserver` on `<html>` `data-theme`; call `map.setStyle()` on change |
| `frontend/src/components/map/MapCanvas.test.tsx` | Modify | Add test asserting `setStyle` is called on `data-theme` mutation |
| `frontend/src/components/map/basemap-style.ts` | Modify | Export both `basemapStyleLight` and `basemapStyleDark`; keep `basemapStyle` as light alias |
| `frontend/src/styles.css` | Modify | Replace 35 hardcoded `font-size` literals with `var(--type-*)` tokens |
| `docs/specs/2026-05-09-v3-token-mapping.md` | Create | Companion token translation table (mock → production names) |
| `.github/workflows/lint.yml` | Modify | Add forbidden-token grep step |

---

## Task 1: Create `frontend/src/styles/tokens.css` — three-tier token contract

The file declares (a) raw primitives on `:root`, (b) semantic tokens on `:root[data-theme="light"]` and `:root[data-theme="dark"]`, (c) component aliases, and (d) the type ramp. No test file — this is pure CSS, verified by visual inspection and the lint guard in Task 8.

**Files:**
- Create: `frontend/src/styles/tokens.css`

- [ ] **Step 1: Create the file.**

Create `frontend/src/styles/tokens.css` with the following content:

```css
/*
 * Three-tier token contract for the Sky Atlas redesign.
 *
 * Layer 1 — Primitives: raw scale values, no semantic meaning.
 *   Declared on :root. Never consumed in component CSS directly.
 *
 * Layer 2 — Semantic: role-named, mode-paired via [data-theme].
 *   Declared on :root[data-theme="light"] and :root[data-theme="dark"].
 *   All component CSS uses these.
 *
 * Layer 3 — Component: scoped aliases that make light/dark a 1-line
 *   override. Declared as CSS custom properties on the component selector.
 *
 * Type ramp and font-stack are also declared here (Layer 1 scale).
 *
 * Spec: docs/design/01-spec/tokens.md
 * Phase: docs/design/02-phases/phase-1-token-foundation.md
 */

/* ── Layer 1: Primitives ────────────────────────────────────────────── */
:root {
  /* Warm cream scale (light surfaces) */
  --c-warm-50:  #fafaf6;
  --c-warm-100: #f0ece4;
  --c-warm-200: #e6e0d4;

  /* Sky / Sand / Ember — cluster density triad (measured contrast) */
  --c-sky-500:   #6ec5d9;   /* 8.2:1 against #1a1a1a */
  --c-sand-500:  #e8c060;   /* 10.4:1 against #1a1a1a */
  --c-ember-500: #e87a4a;   /* 5.1:1 against #1a1a1a */

  /* Accent hues (mode-paired) */
  --c-orange-500: #f5853b;  /* sunrise — light accent */
  --c-cyan-500:   #6db8d4;  /* moon — dark accent */
  --c-deep-ember: #c43a1a;  /* notable — distinct from accent */

  /* Navy / dark scale */
  --c-navy-50:  #f5f7fb;
  --c-navy-900: #0d1424;

  /* ── Type ramp (Apple HIG-derived, no webfont) ────────────────────── */
  --type-xs:   11px;  /* meta labels, captions */
  --type-sm:   13px;  /* body small, secondary */
  --type-base: 15px;  /* body */
  --type-md:   17px;  /* species name in row, modal headings */
  --type-lg:   22px;  /* surface section titles */
  --type-hero: 34px;  /* lede, detail-surface species name */
  --lede-size: 26px;  /* documented exception between lg and hero */

  --font-stack:
    -apple-system, BlinkMacSystemFont, "Segoe UI Variable",
    "Helvetica Neue", "Inter", sans-serif;

  --font-weight-regular:  400;
  --font-weight-medium:   500;
  --font-weight-semibold: 600;
  --font-weight-bold:     700;
  --font-weight-heavy:    800;
}

/* ── Layer 2: Semantic — light mode ─────────────────────────────────── */
:root[data-theme="light"] {
  --color-bg-page:    var(--c-warm-50);
  --color-bg-surface: #ffffff;
  --color-bg-tint:    var(--c-warm-100);
  --color-bg-skeleton: var(--c-warm-100); /* alias of bg-tint initially */

  --color-text-strong: #1a1a1a;
  --color-text-body:   #2a2a2a;
  --color-text-muted:  #5a5a5a;
  --color-text-subtle: #8a8a8a;

  --color-border-ui: var(--c-warm-200);

  /* RENAMED from mock --accent; DO NOT collide with --color-accent-notable-fg */
  --color-decision-point: var(--c-orange-500);

  --color-density-low:  var(--c-sky-500);
  --color-density-mid:  var(--c-sand-500);
  --color-density-high: var(--c-ember-500);
  --color-density-text: #1a1a1a;

  /* PRESERVED from existing codebase — do not rename */
  --color-accent-notable-fg: var(--c-deep-ember);
  --color-error-bg:     #fcebe4;
  --color-error-border: #e8a890;
  --color-error-text:   #8a3a1a;
}

/* ── Layer 2: Semantic — dark mode ──────────────────────────────────── */
/*
 * Dark basemap is gated on G7/G8 (family palette contrast against dark
 * tiles). If G8 fails, dark mode ships with the same positron basemap as
 * light; the basemap swap in MapCanvas is a no-op until G8 passes.
 * See docs/design/01-spec/open-questions.md.
 */
:root[data-theme="dark"] {
  --color-bg-page:    var(--c-navy-900);
  --color-bg-surface: #131c30;
  --color-bg-tint:    #1c2640;
  --color-bg-skeleton: #1c2640;

  --color-text-strong: #f5f7fb;
  --color-text-body:   #d8dee8;
  --color-text-muted:  #8a98ad;
  --color-text-subtle: #5a6478;

  --color-border-ui: #283354;

  --color-decision-point: var(--c-cyan-500);

  --color-density-low:  #4a8aa8;
  --color-density-mid:  #c49850;
  --color-density-high: #c46038;
  --color-density-text: #f5f7fb;

  --color-accent-notable-fg: var(--c-orange-500);
  --color-error-bg:     #3a1a1a;
  --color-error-border: #6a3030;
  --color-error-text:   #f5b8a8;
}

/* ── Layer 3: Component aliases ─────────────────────────────────────── */
/*
 * Component tokens scope to their selector so light/dark is a 1-line
 * override on the component scope rather than per-property.
 * Expand this block as Phase 2 primitives land.
 */
.feed-row {
  --feed-row-bg:       var(--color-bg-surface);
  --feed-row-bg-hover: var(--color-bg-tint);
}
```

- [ ] **Step 2: Verify the file exists and has no syntax errors.**

Run: `npm run build --workspace @bird-watch/frontend`

The build must succeed. Vite will pick up `tokens.css` once it is imported in Task 2. For now the file is an orphan — no build error expected, but the build confirms Vite can see the `styles/` subdirectory after the new file lands.

Actually — the orphan file won't be compiled until it is imported. Run instead:

```bash
node --input-type=module <<'EOF'
import { readFileSync } from 'fs';
const css = readFileSync('frontend/src/styles/tokens.css', 'utf8');
console.log('tokens.css line count:', css.split('\n').length);
EOF
```

Expected: prints a line count ≥ 100. This confirms the file landed at the right path.

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/styles/tokens.css
git commit -m "$(cat <<'EOF'
feat(styles): add three-tier tokens.css (Sky Atlas Phase 1)

Establishes the primitive → semantic → component token contract that
underpins the Sky Atlas redesign. Primitives declare raw scale; semantic
tokens pair each role to light/dark via [data-theme]; component aliases
scope overrides to their selector. Type ramp (--type-xs..hero) and
--font-stack also land here.

No consumers yet — wired in subsequent commits.

Spec: docs/design/01-spec/tokens.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire `tokens.css` into `main.tsx` and update `basemap-style.ts`

Import `tokens.css` so the custom properties are live in every render. Also add the dark basemap URL to `basemap-style.ts` so `MapCanvas` can swap it in Task 6.

**Files:**
- Modify: `frontend/src/main.tsx` (line 9)
- Modify: `frontend/src/components/map/basemap-style.ts`

- [ ] **Step 1: Add the import in `main.tsx`.**

In `frontend/src/main.tsx`, replace:

```typescript
import './analytics.js';
import './styles.css';
```

with:

```typescript
import './analytics.js';
import './styles/tokens.css';
import './styles.css';
```

`tokens.css` must come BEFORE `styles.css` so the custom properties are declared before any rule in `styles.css` references them. `styles.css` declares its own `--color-*` tokens on `:root` (lines 1–63) which coexist with the semantic tokens; the semantic tokens on `[data-theme]` selectors have higher specificity than `:root` when the attribute is present, so the three-tier tokens win without requiring any edits to `styles.css`'s existing `:root` block.

- [ ] **Step 2: Add the dark basemap export to `basemap-style.ts`.**

Replace the content of `frontend/src/components/map/basemap-style.ts` with:

```typescript
/**
 * Basemap URLs for the map surface.
 *
 * Light: OpenFreeMap positron — free, MapLibre-compatible.
 * Dark:  OpenFreeMap dark — gated on G7/G8 contrast gate; see
 *        docs/design/01-spec/open-questions.md. If the gate fails,
 *        MapCanvas falls back to the light basemap for both modes.
 *
 * `basemapStyle` is kept as a light alias so existing callers compile
 * without changes until Phase 3 wires the theme-aware prop.
 *
 * Prototype finding 2 (docs/plans/2026-04-22-map-v1-prototype/learnings.md):
 * positron emits MapLibre warnings at zoom >7 — cosmetic, not crashes.
 */
export const basemapStyleLight = 'https://tiles.openfreemap.org/styles/positron';
export const basemapStyleDark  = 'https://tiles.openfreemap.org/styles/dark';

/** Backward-compatible alias — Phase 3 will replace callsites with the
 *  theme-aware selection. */
export const basemapStyle = basemapStyleLight;
```

- [ ] **Step 3: Run the full frontend test suite to confirm no regressions.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass. Neither change alters any exported TypeScript value or React component behavior.

- [ ] **Step 4: Run the build.**

Run: `npm run build --workspace @bird-watch/frontend`

Expected: build succeeds. Verify `tokens.css` content appears in the bundled CSS:

```bash
grep -c 'data-theme' frontend/dist/assets/index-*.css
```

Expected: returns ≥ 2 (the `[data-theme="light"]` and `[data-theme="dark"]` selectors).

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/main.tsx frontend/src/components/map/basemap-style.ts
git commit -m "$(cat <<'EOF'
feat(styles): wire tokens.css import; add dark basemap URL (Sky Atlas Phase 1)

tokens.css is now loaded before styles.css so [data-theme] semantic
tokens are available to all component rules. basemap-style.ts exports
both positron (light) and dark URLs; the light alias keeps existing
callsites green until Phase 3 swaps the theme-aware prop.

Spec: docs/design/01-spec/tokens.md §Light/dark mechanic

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add inline blocking script to `index.html` for FOUC-free `[data-theme]`

The inline script in `<head>` runs before paint. It reads `localStorage['theme']` (or falls back to `prefers-color-scheme`) and writes `data-theme` on `<html>`. Without this, on first paint the browser renders without a `[data-theme]` attribute and semantic tokens resolve to `initial` (unset), causing a flash.

**Files:**
- Modify: `frontend/index.html`

There is no unit test for this: jsdom does not execute inline scripts during Vitest test runs. Correct behavior is verified by the Playwright smoke in Task 9.

- [ ] **Step 1: Add the inline blocking script.**

Replace `frontend/index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>bird-watch — Arizona</title>
    <!--
      Inline blocking script: sets [data-theme] on <html> before first paint
      to prevent FOUC. Reads localStorage['theme']; falls back to
      prefers-color-scheme on first visit. User's explicit toggle takes
      precedence over the OS preference after first load.

      Spec: docs/design/01-spec/tokens.md §Light/dark mechanic
    -->
    <script>
      (function () {
        var t = localStorage.getItem('theme');
        if (!t) {
          t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
        }
        document.documentElement.setAttribute('data-theme', t);
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Run the build to confirm the script lands in the output HTML.**

Run: `npm run build --workspace @bird-watch/frontend`

Expected: build succeeds. Inspect `frontend/dist/index.html`:

```bash
grep -c 'data-theme' frontend/dist/index.html
```

Expected: returns ≥ 1 (the inline script that calls `setAttribute('data-theme', t)`).

- [ ] **Step 3: Commit.**

```bash
git add frontend/index.html
git commit -m "$(cat <<'EOF'
feat(html): inline blocking script sets [data-theme] pre-paint (Sky Atlas Phase 1)

Without this script, [data-theme] is absent on first paint and semantic
tokens resolve to initial — a flash of unstyled content. The IIFE reads
localStorage['theme'] (or matchMedia fallback) and stamps the attribute
on <html> before any CSS is applied.

Spec: docs/design/01-spec/tokens.md §Light/dark mechanic

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create `frontend/src/config/region.ts`

Single-source-of-truth for the region label consumed by the wordmark and lede. Phase 1 ships the module; Phase 3 wires it into the header component.

**Files:**
- Create: `frontend/src/config/region.ts`

- [ ] **Step 1: Write the failing test first.**

Create `frontend/src/config/region.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { REGION_LABEL } from './region.js';

describe('REGION_LABEL', () => {
  it('is the string "Arizona"', () => {
    expect(REGION_LABEL).toBe('Arizona');
  });

  it('is a non-empty string', () => {
    expect(typeof REGION_LABEL).toBe('string');
    expect(REGION_LABEL.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails.**

Run: `npm run test --workspace @bird-watch/frontend -- region.test.ts`

Expected: `Cannot find module './region.js'` or equivalent module-not-found error.

- [ ] **Step 3: Create the implementation.**

Create `frontend/src/config/region.ts`:

```typescript
/**
 * Region configuration.
 *
 * REGION_LABEL is the source of truth for the region name used in the
 * wordmark ("Bird Maps · Arizona"), the lede, and any region claim in
 * the UI. Change this string to relocate the application to a different
 * region — downstream consumers read it from here.
 *
 * Spec: docs/design/01-spec/architecture.md §Cross-cutting structures
 */
export const REGION_LABEL = 'Arizona' as const;
```

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `npm run test --workspace @bird-watch/frontend -- region.test.ts`

Expected: both tests pass.

- [ ] **Step 5: Run the full frontend test suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/config/region.ts frontend/src/config/region.test.ts
git commit -m "$(cat <<'EOF'
feat(config): add REGION_LABEL constant in config/region.ts (Sky Atlas Phase 1)

Single source of truth for the region name used in the wordmark and lede.
Phase 3 wires this into the header component; shipping the module now
keeps config/region.ts available to any consumer in Phase 2+.

Spec: docs/design/01-spec/architecture.md §Cross-cutting structures

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create `ThemeToggle.tsx` with unit tests

The toggle button reads the current `[data-theme]` attribute, writes the opposite value to `localStorage['theme']` and `document.documentElement`, and announces the new theme via `aria-label`. `MutationObserver` in `MapCanvas` (Task 6) will pick up the attribute change automatically.

**Files:**
- Create: `frontend/src/components/ThemeToggle.tsx`
- Create: `frontend/src/components/ThemeToggle.test.tsx`

- [ ] **Step 1: Write the failing tests.**

Create `frontend/src/components/ThemeToggle.test.tsx`:

```typescript
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
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `npm run test --workspace @bird-watch/frontend -- ThemeToggle.test.tsx`

Expected: `Cannot find module './ThemeToggle.js'` or equivalent. All 8 tests fail.

- [ ] **Step 3: Create the implementation.**

Create `frontend/src/components/ThemeToggle.tsx`:

```typescript
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
```

- [ ] **Step 4: Run the ThemeToggle tests to confirm they pass.**

Run: `npm run test --workspace @bird-watch/frontend -- ThemeToggle.test.tsx`

Expected: all 8 tests pass.

- [ ] **Step 5: Run the full frontend test suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/ThemeToggle.tsx frontend/src/components/ThemeToggle.test.tsx
git commit -m "$(cat <<'EOF'
feat(components): add ThemeToggle with aria-label and localStorage persistence (Sky Atlas Phase 1)

Toggles [data-theme] on <html> and persists to localStorage so the
inline blocking script in index.html restores the user's choice on next
load. MutationObserver in MapCanvas picks up the attribute change and
swaps the basemap without requiring a prop. aria-live="polite" announces
the new mode to screen readers.

Spec: docs/design/01-spec/tokens.md §Light/dark mechanic

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire `MapCanvas.tsx` to swap basemap on `[data-theme]` change

A `MutationObserver` on `document.documentElement` watches the `data-theme` attribute. When it changes, the observer calls `map.setStyle()` with the appropriate basemap URL. The observer is registered after `mapReady` becomes true (the map instance exists) and cleaned up on unmount.

**Files:**
- Modify: `frontend/src/components/map/MapCanvas.tsx`
- Modify: `frontend/src/components/map/MapCanvas.test.tsx`

- [ ] **Step 1: Write the failing test.**

Open `frontend/src/components/map/MapCanvas.test.tsx`. Find the end of the existing test suite (the final `});` of the outermost `describe`). Add the following test block immediately before that closing bracket:

```typescript
  // --- Phase 1: [data-theme] MutationObserver for basemap swap ---

  describe('[data-theme] MutationObserver swaps basemap', () => {
    it('calls map.setStyle with dark URL when data-theme changes to dark', async () => {
      // Set starting theme to light
      document.documentElement.setAttribute('data-theme', 'light');

      const fakeMap = makeFakeMap({});
      // setStyle must be a spy on the fakeMap
      fakeMap.setStyle = vi.fn();

      render(
        <MapCanvas
          observations={[]}
          silhouettes={[]}
          onSelectSpecies={vi.fn()}
          onViewportChange={vi.fn()}
          mapRef={{ current: fakeMap }}
        />
      );

      // Wait for mapReady (the observer registers after the load event)
      await waitFor(() => {
        expect(fakeMap.on).toHaveBeenCalledWith('load', expect.any(Function));
      });

      // Simulate the load event firing so mapReady becomes true
      const loadCalls = (fakeMap.on as ReturnType<typeof vi.fn>).mock.calls;
      const loadHandler = loadCalls.find(([event]: [string]) => event === 'load')?.[1];
      if (loadHandler) loadHandler({ target: fakeMap });

      // Now mutate the attribute — MutationObserver should fire
      act(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
      });

      await waitFor(() => {
        expect(fakeMap.setStyle).toHaveBeenCalledWith(
          'https://tiles.openfreemap.org/styles/dark',
        );
      });

      // Cleanup
      document.documentElement.setAttribute('data-theme', 'light');
    });

    it('calls map.setStyle with light URL when data-theme changes to light', async () => {
      document.documentElement.setAttribute('data-theme', 'dark');

      const fakeMap = makeFakeMap({});
      fakeMap.setStyle = vi.fn();

      render(
        <MapCanvas
          observations={[]}
          silhouettes={[]}
          onSelectSpecies={vi.fn()}
          onViewportChange={vi.fn()}
          mapRef={{ current: fakeMap }}
        />
      );

      await waitFor(() => {
        expect(fakeMap.on).toHaveBeenCalledWith('load', expect.any(Function));
      });

      const loadCalls = (fakeMap.on as ReturnType<typeof vi.fn>).mock.calls;
      const loadHandler = loadCalls.find(([event]: [string]) => event === 'load')?.[1];
      if (loadHandler) loadHandler({ target: fakeMap });

      act(() => {
        document.documentElement.setAttribute('data-theme', 'light');
      });

      await waitFor(() => {
        expect(fakeMap.setStyle).toHaveBeenCalledWith(
          'https://tiles.openfreemap.org/styles/positron',
        );
      });

      document.documentElement.removeAttribute('data-theme');
    });
  });
```

**Important:** If `makeFakeMap` in the existing test file does not include a `setStyle` property in its default shape, you will need to add it. Scan lines 100–130 of `MapCanvas.test.tsx` for the `makeFakeMap` factory; if `setStyle` is absent, add `setStyle: vi.fn()` to the returned object literal. The failing test will make this visible.

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `npm run test --workspace @bird-watch/frontend -- MapCanvas.test.tsx`

Expected: both new `[data-theme] MutationObserver` tests fail — `map.setStyle` is never called because the observer does not exist yet.

- [ ] **Step 3: Add the `MutationObserver` to `MapCanvas.tsx`.**

In `frontend/src/components/map/MapCanvas.tsx`, add the following import at the top of the file (alongside existing imports from `./basemap-style.js`):

Replace:
```typescript
import { basemapStyle } from './basemap-style.js';
```

with:
```typescript
import { basemapStyleLight, basemapStyleDark } from './basemap-style.js';
```

Then find the `mapStyle={basemapStyle}` prop on the `<MapView>` component (line 794 at plan-write time). Replace:

```typescript
        mapStyle={basemapStyle}
```

with:

```typescript
        mapStyle={
          document.documentElement.getAttribute('data-theme') === 'dark'
            ? basemapStyleDark
            : basemapStyleLight
        }
```

Next, add a `useEffect` for the `MutationObserver`. Place it near the other map lifecycle effects (after the `mapReady` check). Find the block starting with `// Track final zoom for the hit-target gate` (around line 448). Add the following effect AFTER the existing `useEffect` blocks that depend on `[mapReady]`, before the `mosaicEntries` memo:

```typescript
  // Phase 1: [data-theme] observer — swap basemap when user toggles theme.
  // Registered after mapReady so the map instance is guaranteed to exist.
  // Cleaned up on unmount to prevent leaks.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'data-theme'
        ) {
          const theme = document.documentElement.getAttribute('data-theme');
          const style = theme === 'dark' ? basemapStyleDark : basemapStyleLight;
          map.setStyle(style);
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, [mapReady]);
```

- [ ] **Step 4: Run the MapCanvas tests to confirm the new tests pass.**

Run: `npm run test --workspace @bird-watch/frontend -- MapCanvas.test.tsx`

Expected: both new MutationObserver tests pass. All previously-passing tests still pass.

- [ ] **Step 5: Run the full frontend test suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/map/MapCanvas.tsx \
        frontend/src/components/map/MapCanvas.test.tsx \
        frontend/src/components/map/basemap-style.ts
git commit -m "$(cat <<'EOF'
feat(map): MutationObserver swaps basemap on [data-theme] change (Sky Atlas Phase 1)

Registers a MutationObserver on document.documentElement after mapReady;
calls map.setStyle(positron|dark) when the data-theme attribute mutates.
Observer is disconnected on unmount. basemap-style.ts exports named light
and dark URLs; the backward-compatible basemapStyle alias is retained.

Spec: docs/design/01-spec/tokens.md §Light/dark mechanic

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Migrate 35 hardcoded `font-size` literals in `styles.css` to type ramp tokens

`styles.css` currently has 35 hardcoded `font-size` pixel literals (verified by `grep -n 'font-size:' frontend/src/styles.css` at plan-write time). Each maps to one of the 6 ramp tokens or the two special values below. No computed values change — this is a referencing migration only.

**Mapping used:**

| Literal | Token | Lines in styles.css (at plan-write time) |
|---|---|---|
| `11px` | `var(--type-xs)` | 842, 904 |
| `12px` | `var(--type-xs)` | 219, 262, 571, 587, 714, 786, 815, 924, 935 |
| `13px` | `var(--type-sm)` | 156, 236, 253, 351, 358, 371, 392, 454, 457, 516, 526, 660, 683, 755 |
| `14px` | `var(--type-sm)` | 227, 272, 332, 449, 677 |
| `15px` | `var(--type-base)` | 293 |
| `18px` | `var(--type-md)` | 649, 912 |
| `20px` | `var(--type-lg)` | 444 |

Note: `11px` and `12px` both map to `--type-xs` (11px). The existing `12px` usages are secondary labels and time-stamps where 11px reads correctly at the intended weight; this is a deliberate ramp decision (spec §Type ramp). If any 12px usage should stay 12px for contrast reasons, leave it as a literal and document the exception inline — do not silently collapse it.

After reviewing the usage contexts (labels, captions, timestamp text), all 9 existing `12px` usages collapse cleanly to `--type-xs`. No exceptions needed.

**Files:**
- Modify: `frontend/src/styles.css` (35 replacements)

There is no unit test for CSS literals. Correctness is verified by:
1. `npm run build` (Vite lints the CSS for syntax errors).
2. `grep -c 'font-size: [0-9]' frontend/src/styles.css` must return `0` after migration.
3. Playwright visual smoke in Task 9.

- [ ] **Step 1: Write the `grep` pre-check to confirm 35 literals exist.**

Run:
```bash
grep -c 'font-size: [0-9]' /Users/j/repos/bird-watch/frontend/src/styles.css
```

Expected: `35`. If the count differs, do a full `grep -n 'font-size:' frontend/src/styles.css` to see the current state before editing.

- [ ] **Step 2: Replace all 35 literals.**

Using a single `sed` pass to avoid partial rewrites. Run from the repo root:

```bash
sed -i '' \
  -e 's/font-size: 11px;/font-size: var(--type-xs);/g' \
  -e 's/font-size: 12px;/font-size: var(--type-xs);/g' \
  -e 's/font-size: 13px;/font-size: var(--type-sm);/g' \
  -e 's/font-size: 14px;/font-size: var(--type-sm);/g' \
  -e 's/font-size: 15px;/font-size: var(--type-base);/g' \
  -e 's/font-size: 18px;/font-size: var(--type-md);/g' \
  -e 's/font-size: 20px;/font-size: var(--type-lg);/g' \
  frontend/src/styles.css
```

- [ ] **Step 3: Confirm zero literals remain.**

Run:
```bash
grep -c 'font-size: [0-9]' frontend/src/styles.css
```

Expected: `0`.

- [ ] **Step 4: Run the build to confirm no CSS syntax errors.**

Run: `npm run build --workspace @bird-watch/frontend`

Expected: build succeeds.

- [ ] **Step 5: Run the full frontend test suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass. CSS literal changes are invisible to Vitest (jsdom does not compute custom property values).

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/styles.css
git commit -m "$(cat <<'EOF'
refactor(styles): migrate 35 font-size literals to type ramp tokens (Sky Atlas Phase 1)

Replaces all hardcoded px font-size values in styles.css with
--type-{xs,sm,base,md,lg} token references. Computed values are
identical — this is an indirection migration, not a redesign. The
six-step ramp is now the single source of truth for text sizing.

Mapping: 11-12px→--type-xs, 13-14px→--type-sm, 15px→--type-base,
18px→--type-md, 20px→--type-lg.

Spec: docs/design/01-spec/tokens.md §Type ramp

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add CI lint guard for forbidden raw token names

The forbidden list is the set of v3/v4 mock token names that would silently collide if dropped into production CSS. The guard runs in CI and must return zero matches. Rationale for grep-over-stylelint: stylelint is not currently installed in this project; adding it requires a devDependency, a config file, and additional CI matrix time. A single grep line in the existing `lint.yml` is zero-cost and covers exactly this one class of error. If stylelint is added for other reasons in Phase 2+, the grep rule should be removed.

**Files:**
- Modify: `.github/workflows/lint.yml`

- [ ] **Step 1: Read the current lint workflow.**

Run: `cat .github/workflows/lint.yml`

Identify the final step in the `lint` job. The new step goes after all existing linting steps (ESLint, TypeScript checks) but before any `upload-artifact` step if one exists.

- [ ] **Step 2: Add the forbidden-token grep step.**

In `.github/workflows/lint.yml`, find the last `- name:` step inside the `lint` job and add the following step immediately after it:

```yaml
      - name: Forbidden raw token names (Sky Atlas Phase 1 lint guard)
        run: |
          # Fail if any source file uses the v3/v4 mock token names directly.
          # These names collide silently with production --color-* tokens.
          # Use production names instead: see docs/design/01-spec/tokens.md §Namespace migration.
          if grep -rE \
            'var\(--(accent|notable|bg-page|bg-surface|bg-tint|text-strong|text-body|text-muted|text-subtle|border)([^-]|$)' \
            frontend/src/ ; then
            echo "ERROR: Forbidden raw token name found. Use --color-* production names."
            exit 1
          fi
```

- [ ] **Step 3: Verify the guard passes on the current codebase.**

Run locally to confirm zero matches before pushing:

```bash
grep -rE \
  'var\(--(accent|notable|bg-page|bg-surface|bg-tint|text-strong|text-body|text-muted|text-subtle|border)([^-]|$)' \
  frontend/src/
```

Expected: no output (zero matches). If there are matches, they are legacy usages that must be migrated before committing.

- [ ] **Step 4: Run lint to confirm no regressions in existing lint rules.**

Run: `npm run lint`

Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add .github/workflows/lint.yml
git commit -m "$(cat <<'EOF'
ci(lint): add forbidden raw token name grep guard (Sky Atlas Phase 1)

Fails CI if any frontend/src/ file references the v3/v4 mock token
names (--accent, --notable, --bg-page, etc.) that would silently
collide with production --color-* tokens. grep chosen over stylelint
because stylelint is not yet installed; a single grep step is zero-cost
and covers exactly this failure class.

Spec: docs/design/01-spec/tokens.md §Lint guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Create companion token translation table

The companion doc is a required Phase 1 artifact (listed in `docs/design/02-phases/phase-1-token-foundation.md` §What ships). It records the mock → production name migration so reviewers and future implementers can audit the namespace without reading all of `tokens.md`.

**Files:**
- Create: `docs/specs/2026-05-09-v3-token-mapping.md`

- [ ] **Step 1: Write the file.**

Create `docs/specs/2026-05-09-v3-token-mapping.md`:

```markdown
# v3 Token Mapping — Mock → Production Names

Companion artifact for Sky Atlas Phase 1 (`docs/plans/2026-05-09-sky-atlas-phase-1-token-foundation.md`).

Records the translation from v3/v4 Figma mock token names to the production `--color-*` namespace. The production names coexist with the existing flat `:root` tokens in `frontend/src/styles.css:1–63` without collision.

## Translation table

| Mock name (v3/v4) | Production name | Status | Notes |
|---|---|---|---|
| `--bg-page` | `--color-bg-page` | Exists in styles.css | Semantic token on `[data-theme]` overrides the `:root` declaration |
| `--bg-surface` | `--color-bg-surface` | Exists in styles.css | Same override mechanism |
| `--bg-tint` | `--color-bg-tint` | Exists in styles.css | Same |
| `--bg-skeleton` | `--color-bg-skeleton` | **New in tokens.css** | Aliases `--color-bg-tint` initially; Phase 2 may diverge |
| `--text-strong` | `--color-text-strong` | Exists in styles.css | — |
| `--text-body` | `--color-text-body` | Exists in styles.css | — |
| `--text-muted` | `--color-text-muted` | Exists in styles.css | — |
| `--text-subtle` | `--color-text-subtle` | Exists in styles.css | — |
| `--border` | `--color-border-ui` | Exists in styles.css | Live codebase already uses `--color-border-ui` |
| `--accent` | `--color-decision-point` | **New in tokens.css** | DO NOT use `--color-accent-notable-fg` — different semantic |
| `--notable` | `--color-accent-notable-fg` | Exists in styles.css | Preserved as-is; DO NOT rename |
| `--font` | (dropped) | — | `body { font-family: var(--font-stack) }` replaces it |
| `--density-sky` | `--color-density-low` | **New in tokens.css** | Cluster low-density tier |
| `--density-sand` | `--color-density-mid` | **New in tokens.css** | Cluster mid-density tier |
| `--density-ember` | `--color-density-high` | **New in tokens.css** | Cluster high-density tier |

## Lint guard

The CI step `Forbidden raw token names` in `.github/workflows/lint.yml` fails on any
`var(--<mock-name>)` usage outside a legacy scope. See `docs/design/01-spec/tokens.md §Lint guard`.

## Source

Canonical spec: `docs/design/01-spec/tokens.md §Namespace migration`
```

- [ ] **Step 2: Commit.**

```bash
git add docs/specs/2026-05-09-v3-token-mapping.md
git commit -m "$(cat <<'EOF'
docs(specs): add v3 token mapping companion artifact (Sky Atlas Phase 1)

Records mock-to-production token name translation for reviewers and
future implementers. Companion to the Phase 1 plan; required artifact
per docs/design/02-phases/phase-1-token-foundation.md §What ships.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Full validation suite

Run the complete local gate before opening the PR.

**Files:** none modified.

- [ ] **Step 1: Run the full unit test suite from repo root.**

Run: `npm test`

Expected: all unit tests pass across all workspaces (frontend, services/read-api, services/ingestor, packages/db-client, packages/shared-types).

- [ ] **Step 2: Run the lint suite.**

Run: `npm run lint`

Expected: no ESLint errors. The forbidden-token grep passes (zero matches). If any new ESLint rule fires on the changes, fix in place — do not silence with `eslint-disable`.

Run also the forbidden-token grep manually:

```bash
grep -rE \
  'var\(--(accent|notable|bg-page|bg-surface|bg-tint|text-strong|text-body|text-muted|text-subtle|border)([^-]|$)' \
  frontend/src/
```

Expected: no output.

- [ ] **Step 3: Run the frontend build.**

Run: `npm run build --workspace @bird-watch/frontend`

Expected: build succeeds. Spot-check the output:

```bash
# tokens.css semantic selectors in bundle
grep -c 'data-theme' frontend/dist/assets/index-*.css

# type ramp tokens in bundle
grep -c 'type-xs\|type-sm\|type-base\|type-md\|type-lg' frontend/dist/assets/index-*.css

# zero remaining pixel font-size literals in source
grep -c 'font-size: [0-9]' frontend/src/styles.css
```

Expected: first two return ≥ 1; third returns `0`.

- [ ] **Step 4: Run the e2e suite.**

Run: `npm run test:e2e --workspace @bird-watch/frontend`

Expected: all Playwright specs pass (`axe.spec.ts` and all other specs). Phase 1 makes no visible structural changes — all existing e2e assertions should hold.

- [ ] **Step 5: Playwright visual smoke for theme toggle (manual).**

This step cannot be automated in the e2e suite (no `ThemeToggle` is wired into the app shell in Phase 1 — it ships in Phase 3 as part of the persistent chrome). Verify the token wiring manually:

Run: `npm run dev --workspace @bird-watch/frontend` (in a separate terminal).

In Chrome DevTools console on `http://localhost:5173`:

```javascript
// Test 1: Confirm tokens.css semantic tokens are live
document.documentElement.setAttribute('data-theme', 'dark');
getComputedStyle(document.documentElement).getPropertyValue('--color-bg-page');
// Expected: "  #0d1424" (or the --c-navy-900 resolved value)

document.documentElement.setAttribute('data-theme', 'light');
getComputedStyle(document.documentElement).getPropertyValue('--color-bg-page');
// Expected: "  #fafaf6" (or the --c-warm-50 resolved value)

// Test 2: Confirm type ramp tokens are live
getComputedStyle(document.documentElement).getPropertyValue('--type-sm');
// Expected: "  13px"

// Test 3: Confirm FOUC script ran (data-theme present before React mounts)
document.documentElement.getAttribute('data-theme');
// Expected: 'light' or 'dark' (not null)
```

Cleared once console returns the expected values.

---

## Task 11: Open the PR

Use the full PR workflow per `CLAUDE.md` `## PR workflow`.

**Files:** none modified.

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin feat/sky-atlas-phase-1-token-foundation
```

- [ ] **Step 2: Open the PR using the project template.**

All 5 sections required. Screenshots section uses `N/A — not UI` with explanation (Phase 1 is invisible to users — computed values stay identical; no surfaces change visually).

```bash
gh pr create \
  --title "feat: Sky Atlas Phase 1 — token foundation, [data-theme], type ramp" \
  --body "$(cat <<'EOF'
## Summary
- Add `frontend/src/styles/tokens.css`: three-tier CSS token contract (primitive → semantic → component) with `[data-theme="light|dark"]` mode pairs and 6-step type ramp (`--type-xs` through `--type-hero`).
- Wire `tokens.css` import in `main.tsx` (before `styles.css` so custom properties are declared first).
- Add inline blocking `<script>` in `index.html` `<head>` to set `[data-theme]` pre-paint, preventing FOUC.
- Add `frontend/src/config/region.ts` with `REGION_LABEL = 'Arizona'` constant.
- Add `ThemeToggle.tsx` with localStorage persistence and `aria-live` announcement.
- Wire `MapCanvas.tsx` MutationObserver to swap basemap on `data-theme` attribute change.
- Migrate all 35 hardcoded `font-size` literals in `styles.css` to `var(--type-*)` tokens (computed values unchanged).
- Add forbidden-token grep guard to `.github/workflows/lint.yml`: fails CI on `var(--accent)`, `var(--notable)`, and other v3 mock names outside legacy scope.
- Add companion token translation table at `docs/specs/2026-05-09-v3-token-mapping.md`.

## Test plan
- [x] All existing unit tests pass (no regressions from CSS or basemap-style changes).
- [x] 2 tests: `region.test.ts` — `REGION_LABEL` is `'Arizona'`.
- [x] 8 tests: `ThemeToggle.test.tsx` — toggle, localStorage persistence, aria-label updates.
- [x] 2 tests: `MapCanvas.test.tsx` — `setStyle` called with correct URL on data-theme mutation.
- [x] `npm run build` succeeds; `[data-theme]` selectors present in bundled CSS; type ramp tokens present; zero pixel font-size literals remain in source.
- [x] `npm run test:e2e` passes — all axe.spec.ts and other specs green (no visible surface changes).
- [x] Forbidden-token grep returns zero matches on `frontend/src/`.
- [x] Manual DevTools smoke: `getComputedStyle` confirms `--color-bg-page` resolves to the correct value in both modes; `--type-sm` resolves to `13px`; `data-theme` attribute present pre-React-mount.

## Screenshots
N/A — not UI. Phase 1 is infrastructure: the three-tier token contract, type ramp, and [data-theme] mechanic. Computed pixel values are identical to pre-Phase-1 — users see no visual change. Surface-level visual changes ship in Phases 3–5.

## Spec
- `docs/design/01-spec/tokens.md` — token system, namespace migration, type ramp, light/dark mechanic
- `docs/design/01-spec/architecture.md` — [data-theme] overview, config/ module
- `docs/design/02-phases/phase-1-token-foundation.md` — phase scope and acceptance criteria

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Dispatch the bot review.**

Per project CLAUDE.md PR workflow: bot review dispatches through the `julianken-bot` Agent subagent — never via `gh pr review` from the main session.

- [ ] **Step 4: After bot review approves and CI green (test, lint, build, e2e), post the Mergify queue comment.**

```bash
gh pr comment <PR-number> --body "@Mergifyio queue"
```

NEVER use `gh pr merge`. Mergify handles the merge after queue processing.

---

## Acceptance criteria

This plan is complete when ALL of the following are true:

- [ ] Light/dark toggle works: `[data-theme="light"]` and `[data-theme="dark"]` selectors apply the right palette (verified by DevTools `getComputedStyle` smoke).
- [ ] FOUC absent on first load: inline script in `<head>` sets the attribute pre-paint (verified by `grep 'data-theme' frontend/dist/index.html` returning ≥ 1).
- [ ] Lint guard fails CI on `var(--accent)` or `var(--notable)` outside legacy scope (verified by the step in `.github/workflows/lint.yml`).
- [ ] Existing visual surfaces are unchanged: Phase 1 is invisible to users (token semantics differ; computed values stay identical).
- [ ] Type ramp tokens are consumed by all primary text in `styles.css`: `grep -c 'font-size: [0-9]' frontend/src/styles.css` returns `0`.
- [ ] `REGION_LABEL` constant exported from `frontend/src/config/region.ts`.
- [ ] `ThemeToggle.tsx` renders, toggles, persists to localStorage, and announces via `aria-live`.
- [ ] `MapCanvas.tsx` calls `map.setStyle()` with the correct URL on `data-theme` mutation (verified by 2 new tests).
- [ ] All unit tests pass (`npm test`). All e2e specs pass (`npm run test:e2e`). Build succeeds (`npm run build`). Lint clean (`npm run lint`).
- [ ] PR open with standard 5-section body, CI green, bot-reviewed, Mergify queued.

---

## What this plan deliberately does NOT include

To stay scoped per `docs/design/02-phases/phase-1-token-foundation.md §What this phase does NOT include`:

- **No new design-system primitives** (`<StatusBlock>`, `<Photo>`, `<FamilySilhouette>`, `<ClusterPill>`, `<FilterSentence>`) — Phase 2.
- **No primitive values** beyond those named in `tokens.css` — the Phase 2 primitives spec drives the rest.
- **No surface visual changes** — map, feed, species-search, and detail surfaces are pixel-identical post-Phase-1. Phases 3–5 own surface redesign.
- **No webfont** — system stack (`--font-stack`) is the Phase 1 brand choice.
- **No motion changes** — `motion.css` landed in Phase 0 and is already imported.
- **No `family-palette.ts` config module** — deferred to Phase 2 alongside `<FamilySilhouette>`.
- **No `cluster.ts`, `filter.ts`, `freshness.ts` config modules** — Phase 2+.
- **No `<ThemeToggle>` wired into the app shell header** — the component is built in this phase but the persistent chrome redesign (header layout, nav tabs, attribution link, theme toggle placement) ships in Phase 3.
- **No dark basemap activation** — gated on G7/G8 contrast gate; the `MutationObserver` calls `map.setStyle(basemapStyleDark)` but the dark URL is OpenFreeMap dark, not a custom tile pipeline. If G8 fails, revert the `MutationObserver` to a no-op or always return `basemapStyleLight`.
- **No axe e2e contract extensions** — the three new axe branches (detail dialog, bottom sheet at full snap, cluster pill) ship in Phases 4 and 3 respectively.
