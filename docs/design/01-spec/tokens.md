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

## Typography contracts

Seven implicit conventions that every brainstorm mock honours and that production code implements, but that the spec previously left unstated. Captured here so future implementers have an inescapable reference.

### 1. Scientific-name italic — UA-default delegation

Every mock renders scientific names in italic: `sky-atlas-v3.html:466,531,752`; v4 popover; system poster. Production wraps them in `<em>` (`SpeciesDetailSurface.tsx`), which delegates the italic to the browser UA stylesheet default (`font-style: italic`). This is the **contracted approach** — no explicit `font-style: italic` rule in component CSS is required because `<em>` carries semantic italic by definition. If the UA default ever needs overriding (e.g., a future webfont that ships its own italic variant), add `em { font-style: italic; }` to `tokens.css`. Do not lose the italic by switching to a `<span>` without carrying the style.

**Disposition:** `CAPTURED` — v3 CSS evidence at `sky-atlas-v3.html:466` (`font-style: italic` on `.v3-popover-sci`). Implementation: `<em>` element in `SpeciesDetailSurface.tsx`.

### 2. Label uppercase + tracking

Short meta labels (NOTABLE, freshness state line "Updated N min ago · Source: eBird", region strip, masthead overlay family tag) are rendered in `text-transform: uppercase` with `letter-spacing: 1.5px`. Source: `sky-atlas-v3.html:513-520` (`.v3-detail-meta-overlay`). The convention communicates "system label" vs "narrative content" without a separate typeface.

**Rule:** Any element rendered in `--type-xs` or `--type-sm` that functions as a system label (not user-generated content) takes `text-transform: uppercase; letter-spacing: 1.5px`. Elements functioning as body copy or species names do not.

**Disposition:** `CAPTURED` — evidence at `sky-atlas-v3.html:514-515`.

### 3. Letter-spacing scale

Three tiers explicitly used in mocks (do not introduce additional steps without documenting rationale):

| Token | Value | Used for |
|---|---|---|
| `--tracking-tight` | `-0.4px` to `-0.8px` | Hero / display type (species name at `--type-hero` or `--lede-size`) |
| `--tracking-normal` | `0` | Body and secondary text (`--type-base`, `--type-sm`) |
| `--tracking-wide` | `1.5px` | Uppercase labels (`--type-xs`, `--type-sm` uppercase) |

The tight range (`-0.4px` for `--type-md` headings, `-0.8px` for `--type-hero`) mirrors Apple HIG negative tracking at display sizes. Values sourced from `sky-atlas-v3.html:525,745`.

**Disposition:** `CAPTURED` — evidence at `sky-atlas-v3.html:461,525,745` and `sky-atlas-v4.html`. The `--tracking-*` tokens are not yet declared in the CSS block above; they should be added to the `:root` ramp block in Phase 1.

### 4. Line-height per type tier

| Tier | Token | Declared line-height | Notes |
|---|---|---|---|
| Hero / display (`--type-hero`, `--lede-size`) | — | `1` to `1.05` | Tight; space is data at display size |
| Section title (`--type-lg`) | — | `1.15` | Minor breathing room |
| Body (`--type-base`, `--type-md`) | — | `1.4` to `1.5` | Reading comfort |
| Caption / label (`--type-sm`, `--type-xs`) | — | `1.15` to `1.2` | Dense; used in constrained spaces |

Source: `sky-atlas-v3.html:460-461` (`line-height: 1.15` for `.v3-popover-name`), `sky-atlas-v3.html:747` (`line-height: 1.05` for hero name). Implementers must not use `line-height: 1.5` on display-size elements — the compressed line-height is a design intent, not a shortcut.

**Disposition:** `CAPTURED` — evidence across v3 mock CSS. Line-height values should be added as explicit token comments in Phase 1.

### 5. Font-weight role mapping

| Role | Weight | Token |
|---|---|---|
| Hero species name, map legend heading | 800 | `--font-weight-heavy` |
| Section headings, popover species name | 700 | `--font-weight-bold` |
| NOTABLE label, CTA text | 600 | `--font-weight-semibold` |
| Photo credit, secondary meta | 500 | `--font-weight-medium` |
| Body copy, filter sentence | 400 | `--font-weight-regular` |

The five weight tokens in the `:root` ramp above correspond exactly to these five roles. **Do not use numeric weights directly in component CSS** — always reference the semantic token so a future weight audit changes one definition, not N component rules.

Source: v3 and v4 mocks consistently use 800 for hero names (e.g., `sky-atlas-v3.html:745`, `sky-atlas-v4.html:273`), 700 for popover headings.

**Disposition:** `CAPTURED` — weight tokens declared at `:root` above; role assignment added here as contract.

### 6. Font-family token consumption

All component CSS must consume `var(--font-stack)` through `body { font-family }` inheritance. No component may hardcode a `font-family` value or `var(--font-stack)` directly — inheritance from `body` is the correct mechanism. Exception: `<code>` and `<pre>` elements use the browser monospace default. If any element resets `font-family: inherit`, it must be flagged in review as a design-system violation.

**Disposition:** `CAPTURED` — `body { font-family: var(--font-stack); }` is the single declaration point. The lint guard for `--accent` (see Lint guard section) should be extended to catch `font-family:` declarations in component files.

### 7. `font-variant-numeric: tabular-nums` global declaration

`body { font-feature-settings: "tnum"; }` is already declared in the CSS block above. This is the contract: all numeric content (counts, timestamps, percentages) renders in tabular numerics by default because every number on this site is compared — sighting counts, time deltas, family percentages. Components that intentionally render non-tabular numbers (e.g., a running prose sentence containing a number) may opt out with `font-variant-numeric: normal`, but this opt-out must be explicit and documented in a comment.

The `font-feature-settings: "tnum"` approach is preferred over `font-variant-numeric: tabular-nums` because of wider system-font support. Both are equivalent for this font stack, but keep them consistent — don't mix the two syntaxes.

**Disposition:** `CAPTURED` — declared in body block above. The `<Photo>` attribution (credit text) and `<FilterSentence>` copy are the only surfaces where tabular-nums would be unexpected and may warrant `font-variant-numeric: normal`.

---

**W5 audit note (2026-05-11):** These seven contracts were surfaced in `docs/analyses/2026-05-11-brainstorm-vs-prod-fidelity/phase-2/iterator-4-typography-spec-silence.md` as previously unstated. The `<em>` sci-name italic (§1) is shared with the sci-name italic finding in `coverage-matrix-v4.md` row 94. Count: 7 distinct contracts de-duplicated from the 8-row iterator-4 table (the `<em>` contract counted once here; the coverage matrix row captures the same finding from the brainstorm-artifact perspective).

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
