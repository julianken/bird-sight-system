# Phase 0 — Pre-redesign engineering

**Status:** Plan written. Implementation can begin.

**Plan:** [`../../plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md`](../../plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md)

## Goal

Land four pre-redesign engineering changes that resolve the analysis report's structural defects so the Sky Atlas visual redesign can ship on top of a sound foundation. None of these changes are visible UI; this is plumbing.

## What ships

| Change | File | Spec section |
|---|---|---|
| Switch `DEFAULTS.view: 'feed'` → `'map'` | `frontend/src/state/url-state.ts:15–22` | [`../01-spec/url-state.md`](../01-spec/url-state.md) |
| Add `pushState` for detail-surface entry | `frontend/src/state/url-state.ts:71–112` | [`../01-spec/url-state.md`](../01-spec/url-state.md) |
| Global `motion.css` for `prefers-reduced-motion` | `frontend/src/styles/motion.css` (new) + `frontend/src/main.tsx:8–9` | [`../01-spec/motion.md`](../01-spec/motion.md) |
| MapLibre `easeTo` reduced-motion guard | `frontend/src/components/map/MapCanvas.tsx:729` | [`../01-spec/motion.md`](../01-spec/motion.md) |

## Dependencies

None. All four changes are independent of each other and of subsequent phases.

## Acceptance criteria

- Browser back works from a detail surface to the previously-active surface (verified by 6 new url-state tests).
- `DEFAULTS.view === 'map'` (verified by url-state tests).
- CSS-driven transitions and animations collapse to 0ms under `prefers-reduced-motion: reduce` (verified manually + in bundled CSS).
- MapLibre camera animations pass `duration: 0` under reduced-motion (verified by MapCanvas test).
- All existing tests pass (after default-view assertion updates).

## What this phase does NOT include

- No changes to `tokens.ts`, `styles.css`, or any visual styling. (Phase 1.)
- No new design-system primitives. (Phase 2.)
- No surface-level redesign. (Phases 3–5.)
- No metadata, voice, or brand changes. (Phase 6.)
- No `[data-theme]` light/dark scaffold. (Phase 1.)
- No `frontend/src/config/` module. (Phase 1.)

If implementation finds itself touching any of these surfaces, stop and confirm — that work belongs in a later phase's plan, not here.

## Why this is its own phase

These four changes have nothing to do with the visual redesign — they're pre-existing user-contract failures (`replaceState` breaks browser back, `DEFAULTS.view='feed'` misroutes the home, MapLibre animations leak under reduced-motion). Shipping them on a separate code-only PR before the visual redesign begins:

1. Means users see a behavioral fix sooner.
2. Eliminates one axis of complexity from later phases (e.g., Phase 4's detail-surface design doesn't have to design around broken back navigation).
3. Keeps the visual-redesign PRs focused on visual changes — easier to review.

## Cross-references

- Spec sections: [`../01-spec/url-state.md`](../01-spec/url-state.md), [`../01-spec/motion.md`](../01-spec/motion.md)
- Analysis report finding 2.4 (broken browser back), Theme 5 finding 5.6 (motion-leak): [`../03-research/analysis-funnel-summary.md`](../03-research/analysis-funnel-summary.md)
- Implementation plan: [`../../plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md`](../../plans/2026-05-09-sky-atlas-phase-0-pre-redesign.md)
