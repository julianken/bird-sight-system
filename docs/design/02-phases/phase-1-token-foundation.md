# Phase 1 — Token foundation

**Status:** Not yet planned.

**Plan:** to be written via `superpowers:writing-plans` — output to `docs/plans/2026-XX-XX-sky-atlas-phase-1-tokens.md`.

## Goal

Establish the three-tier token contract (primitive → semantic → component), wire `[data-theme]` light/dark, collapse the type system to a 6-step ramp, and add the lint guard that prevents the v3 mock namespace from silently overwriting existing tokens.

## What ships

| Change | File |
|---|---|
| Three-tier token contract (CSS custom properties) | `frontend/src/styles/tokens.css` (new) |
| `[data-theme]` inline blocking script | `frontend/index.html` |
| Type ramp tokens (`--type-xs..hero`, `--font-stack`) | `frontend/src/styles/tokens.css` |
| Token translation table (mock → production names) | `docs/specs/2026-05-09-v3-token-mapping.md` (new — companion artifact) |
| Stylelint guard against forbidden raw token names | `.stylelintrc` or equivalent CI rule |
| Migrate 35+ hardcoded font-size literals to tokens | `frontend/src/styles.css` (existing) |
| `frontend/src/config/region.ts` — `REGION_LABEL` constant | `frontend/src/config/region.ts` (new) |
| Theme toggle component | `frontend/src/components/ThemeToggle.tsx` (new) |
| Theme persistence + `MutationObserver` for basemap swap in `MapCanvas` | `frontend/src/components/map/MapCanvas.tsx` |

## Dependencies

- **Requires Phase 0** to be merged (no overlap, but conflicts are easier to resolve when Phase 0 is in main).
- **Requires G3** (bundle baseline) measured before this phase lands — for regression tracking.
- **Requires G7** (family-color × basemap contrast) before any family-palette token commits — if any earth-tone fails 3:1 against the basemap, that family's palette entry adjusts in this phase.

## Acceptance criteria

- Light/dark toggle works: `[data-theme="light"]` and `[data-theme="dark"]` selectors apply the right palette.
- FOUC absent on first load — inline script in `<head>` sets the attribute pre-paint.
- Lint guard fails CI on `var(--accent)` or `var(--notable)` outside the legacy compatibility window.
- Existing visual surfaces are unchanged — Phase 1 is invisible to users (token semantics differ; computed values stay identical for now).
- Type ramp tokens are consumed by all primary text in `styles.css`; the 35+ hardcoded literals are gone.

## What this phase does NOT include

- No new primitives (`<StatusBlock>` etc. — Phase 2)
- No surface visual changes (Phases 3–5)
- No webfont (system stack stays — design decision)
- No motion changes (motion.css already exists from Phase 0)
- Family-palette JS module — defers to Phase 2 alongside `<FamilySilhouette>` consumer

## Cross-references

- Spec: [`../01-spec/tokens.md`](../01-spec/tokens.md), [`../01-spec/architecture.md`](../01-spec/architecture.md)
- Critique loop 2 K3 (token namespace collision): [`../03-research/critique-loops-summary.md`](../03-research/critique-loops-summary.md)
- Open questions G3, G7: [`../01-spec/open-questions.md`](../01-spec/open-questions.md)
