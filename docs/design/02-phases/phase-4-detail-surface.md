# Phase 4 — Detail surface redesign

**Status:** Not yet planned.

**Plan:** to be written via `superpowers:writing-plans` — output to `docs/plans/2026-XX-XX-sky-atlas-phase-4-detail-surface.md`.

## Goal

Replace the current in-flow detail surface with a modal `<dialog>` on desktop and a bottom-sheet (peek/half/full snap points) on mobile. Photo-as-anchor masthead, `<h1 id="detail-title" tabIndex={-1}>` heading, `aria-labelledby` on the dialog, focus on heading not close button. Resolves the analysis report's longest-running IA seam (no close affordance, no back navigation).

## What ships

| Change | File |
|---|---|
| `<SpeciesDetailModal>` — desktop `<dialog>` wrapper | `frontend/src/components/SpeciesDetailModal.tsx` (new) |
| `<SpeciesDetailSheet>` — mobile bottom-sheet with snap-state machine | `frontend/src/components/SpeciesDetailSheet.tsx` (new) |
| `<SpeciesDetailSurface>` rewrite to consume `<Photo>`, `<h1>` heading, family label, phenology, prose | `frontend/src/components/SpeciesDetailSurface.tsx` |
| App-level routing of detail to modal / sheet based on viewport | `frontend/src/App.tsx` |
| iOS safe-area: `viewport-fit=cover` + `env(safe-area-inset-bottom)` | `frontend/index.html` + sheet CSS |
| `<Photo priority={true}>` masthead with `loading="eager" fetchpriority="high"` | `<SpeciesDetailModal>` and `<SpeciesDetailSheet>` |
| New axe test branches for detail dialog photo path + sheet at full snap | `frontend/e2e/axe.spec.ts` |
| `IntersectionObserver` analytics sentinel re-wiring for new scroll containers | `<SpeciesDetailSurface>` |

## Dependencies

- **Requires Phase 2** (`<Photo>`, `<FamilySilhouette>`, `<StatusBlock>`).
- **Requires G6** (iOS safe-area test) before mobile sheet ships to production.

## Acceptance criteria

- Desktop modal opens from feed-row click / map popover / SpeciesAutocomplete commit; ESC closes; backdrop click closes; focus restores to trigger.
- Mobile sheet opens to peek snap on cluster tap / feed row tap; drag handle + drag-up snaps to half / full; drag-down past peek dismisses.
- At peek and half, map remains live + interactive underneath.
- At full, map gets `pointer-events: none` and `inert` set BEFORE the sheet's role attribute flips to `dialog`.
- New axe assertions pass: `dialog[aria-labelledby]` resolves to non-empty heading; `document.activeElement === #detail-title` after open; sheet at full snap has `role="dialog" aria-label="{species name}"`.
- LCP regression test: photo masthead loads <1s on dev hardware (Lighthouse).
- Analytics IntersectionObserver fires for "scrolled to bottom" inside the new scroll container (modal or sheet, not `<main>`).

## What this phase does NOT include

- Map / Feed / Species surfaces (Phases 3, 5)
- Voice / metadata (Phase 6)

## Implementation order (within phase)

1. Promote `<SpeciesDetailSurface>` to consume `<Photo>` + `<h1>` heading (no modal/sheet yet — surface stays in-flow)
2. Add new axe assertion for `dialog[aria-labelledby]` (initially failing)
3. Build `<SpeciesDetailModal>` (desktop `<dialog>` wrapper); wire from `<App>` with viewport check
4. Verify modal axe passes
5. Build `<SpeciesDetailSheet>` (mobile bottom-sheet); snap-state machine; role-switching; ESC + drag handlers
6. Verify mobile axe + safe-area on physical device
7. Re-wire IntersectionObserver to new scroll roots

## Cross-references

- Spec: [`../01-spec/architecture.md`](../01-spec/architecture.md), [`../01-spec/components.md`](../01-spec/components.md), [`../01-spec/accessibility.md`](../01-spec/accessibility.md)
- Visuals: [`../04-visuals/detail-desktop-pair.png`](../04-visuals/detail-desktop-pair.png), [`../04-visuals/mobile-triplet.png`](../04-visuals/mobile-triplet.png)
- Critique loops K1 (detail dialog heading + focus), K3 (cluster pill — loosely related), K4 (bottom-sheet ARIA): [`../03-research/critique-loops-summary.md`](../03-research/critique-loops-summary.md)
- G6 iOS safe-area: [`../01-spec/open-questions.md`](../01-spec/open-questions.md)
