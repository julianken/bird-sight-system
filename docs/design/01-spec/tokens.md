# Token system

Three layers: primitive → semantic → component. The mock used flat names (`--bg-page`, `--accent`); production translates to the existing codebase's `--color-*` prefix to coexist with `frontend/src/styles.css:1–63` without silent collisions.

## Layers

### 1. Primitives

Raw scale, no semantics. Define each color in N steps so semantic tokens can pick.

```css
:root {
  /* Warm cream scale (light surfaces) */
  --c-warm-50: #fafaf6;
  --c-warm-100: #f0ece4;
  --c-warm-200: #e6e0d4;
  /* … */

  /* Sky / Sand / Ember (cluster density triad — measured contrast) */
  --c-sky-500: #6ec5d9;     /* 8.2:1 against #1a1a1a */
  --c-sand-500: #e8c060;    /* 10.4:1 against #1a1a1a */
  --c-ember-500: #e87a4a;   /* 5.1:1 against #1a1a1a */

  /* Accent hues (mode-paired) */
  --c-orange-500: #f5853b;  /* sunrise — light accent */
  --c-cyan-500: #6db8d4;    /* moon — dark accent */
  --c-deep-ember: #c43a1a;  /* notable — distinct from accent */

  /* Navy / dark scale */
  --c-navy-50: #f5f7fb;
  --c-navy-900: #0d1424;
  /* … */
}
```

Primitives never appear in component CSS directly — only semantic tokens do.

### 2. Semantic (mode-aware)

Role-named, mode-paired via `[data-theme]`:

```css
:root[data-theme="light"] {
  --color-bg-page: var(--c-warm-50);
  --color-bg-surface: #ffffff;
  --color-bg-tint: var(--c-warm-100);
  --color-bg-skeleton: var(--c-warm-100);  /* NEW token */
  --color-text-strong: #1a1a1a;
  --color-text-body: #2a2a2a;
  --color-text-muted: #5a5a5a;
  --color-text-subtle: #8a8a8a;
  --color-border-ui: var(--c-warm-200);
  --color-decision-point: var(--c-orange-500);  /* RENAMED from mock --accent */
  --color-density-low: var(--c-sky-500);
  --color-density-mid: var(--c-sand-500);
  --color-density-high: var(--c-ember-500);
  --color-density-text: #1a1a1a;
  /* PRESERVED unchanged from existing codebase: */
  --color-accent-notable-fg: var(--c-deep-ember);
  --color-error-bg: #fcebe4;
  --color-error-border: #e8a890;
  --color-error-text: #8a3a1a;
}

:root[data-theme="dark"] {
  --color-bg-page: var(--c-navy-900);
  --color-bg-surface: #131c30;
  --color-bg-tint: #1c2640;
  --color-bg-skeleton: #1c2640;
  --color-text-strong: #f5f7fb;
  --color-text-body: #d8dee8;
  --color-text-muted: #8a98ad;
  --color-text-subtle: #5a6478;
  --color-border-ui: #283354;
  --color-decision-point: var(--c-cyan-500);
  --color-density-low: #4a8aa8;
  --color-density-mid: #c49850;
  --color-density-high: #c46038;
  --color-density-text: #f5f7fb;
  --color-accent-notable-fg: var(--c-orange-500);
  /* … */
}
```

### 3. Component (consumed by component CSS)

```css
.feed-row { background: var(--feed-row-bg); }
.feed-row { --feed-row-bg: var(--color-bg-surface); }
```

Component tokens make light/dark a 1-line override and prevent components from grabbing primitives directly.

## Namespace migration

The v3/v4 mocks used unprefixed names (`--accent`, `--bg-page`). Production uses the existing `--color-*` prefix. Translation table:

| Mock name | Production name | Notes |
|---|---|---|
| `--bg-page` | `--color-bg-page` | exists |
| `--bg-surface` | `--color-bg-surface` | exists |
| `--bg-tint` | `--color-bg-tint` | exists |
| `--bg-skeleton` | `--color-bg-skeleton` | **new** — alias of `--color-bg-tint` initially |
| `--text-strong` | `--color-text-strong` | exists |
| `--text-body` | `--color-text-body` | exists |
| `--text-muted` | `--color-text-muted` | exists |
| `--text-subtle` | `--color-text-subtle` | exists |
| `--border` | `--color-border-ui` | exists (note: live codebase already uses `--color-border-ui`) |
| `--accent` | `--color-decision-point` | **new** — DO NOT collide with `--color-accent-notable-fg` |
| `--notable` | `--color-accent-notable-fg` | exists; preserve as-is |
| `--font` | (drop) | hoisted to `body { font-family }` already |
| `--density-sky` / `--density-sand` / `--density-ember` | `--color-density-low/mid/high` | new |

### Lint guard

To prevent silent regressions on the existing `--color-accent-notable-fg` tinting, add a stylelint rule (or a one-line grep in CI) that fails on:

```bash
grep -rE 'var\(--(accent|notable|bg-page|bg-surface|bg-tint|text-strong|text-body|text-muted|text-subtle|border)([^-]|$)' frontend/src/
```

Should return zero matches outside the mock directory. The forbidden list is the v3 mock names that would silently collide if dropped into production CSS.

## Type ramp

6 sizes (Apple HIG-derived), no webfont:

```css
:root {
  --type-xs: 11px;     /* meta labels, captions */
  --type-sm: 13px;     /* body small, secondary */
  --type-base: 15px;   /* body */
  --type-md: 17px;     /* species name in row, modal headings */
  --type-lg: 22px;     /* surface section titles */
  --type-hero: 34px;   /* lede, detail-surface species name */
  --lede-size: 26px;   /* documented exception between lg and hero */

  --font-stack:
    -apple-system, BlinkMacSystemFont, "Segoe UI Variable",
    "Helvetica Neue", "Inter", sans-serif;

  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --font-weight-heavy: 800;
}

body {
  font-family: var(--font-stack);
  font-feature-settings: "tnum";  /* tabular numerics on counts/timestamps */
}
```

The 35+ hardcoded `font-size` literals in the existing `frontend/src/styles.css` migrate to these 6 tokens during component rewrites. The 26px lede sits between `--type-lg` and `--type-hero`; the spec exposes `--lede-size` as a documented exception rather than expanding the ramp to 7.

Webfont swap is a one-token operation if ever needed: change `--font-stack`. The system stack is the brand for v1.

## Light/dark mechanic

Implementation:

1. `<html>` gets a `data-theme="light|dark"` attribute, persisted in `localStorage["theme"]`.
2. Inline blocking `<script>` in `index.html` runs before paint:

```html
<script>
  (function () {
    var t = localStorage.getItem('theme');
    if (!t) {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  })();
</script>
```

3. The theme toggle in the header writes `localStorage["theme"]` and sets the attribute.
4. The MapLibre `<MapCanvas>` listens for theme changes via `MutationObserver` on `<html>` `data-theme` and swaps basemap style accordingly.

`prefers-color-scheme: dark` is **initial default only**. The user's explicit toggle persists.

Why a manual toggle instead of `prefers-color-scheme` alone: the basemap swap is user-visible (positron → dark-matter); a passive OS-query mechanism doesn't give the user a way to pin the choice. See [`accessibility.md`](./accessibility.md) for the SR announcement on theme change.

## Why this token system, not the existing flat one

The existing `frontend/src/styles.css:1–63` has a single tier of `--color-*` tokens declared on `:root`. There is no way for light/dark to override those without a parallel definition for each. The three-tier structure adds the indirection that makes mode-pairing a single override per semantic token, not per component class.

## Source artifacts

- Live token file: `frontend/src/tokens.ts` (existing — JS exports for JSX consumers)
- Live CSS: `frontend/src/styles.css:1–63` (existing — flat namespace)
- Phase 1 deliverable: `frontend/src/styles/tokens.css` (new — three-tier)
- Migration table doc: this file (canonical)

## Phase that ships this

[`../02-phases/phase-1-token-foundation.md`](../02-phases/phase-1-token-foundation.md). The migration is gated by the lint guard landing first (otherwise consumer migration risks silent collision).
