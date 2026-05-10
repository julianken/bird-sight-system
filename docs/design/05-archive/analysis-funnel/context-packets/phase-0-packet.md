# Context Packet: Phase 0 → Phase 1

## Question (one line)
What should inform a redesign of the bird-maps.com site (chrome / surfaces / brand / IA / type / color), holding live map *behavior* constant and only theming its visual layer?

## Repo facts
- React 18 + Vite 8 + TypeScript; MapLibre 5; no router (URL state via `useUrlState`).
- Frontend at `frontend/`; tokens at `frontend/src/tokens.ts`, global CSS at `frontend/src/styles.css`, components at `frontend/src/components/`.
- Four surfaces: `feed`, `map`, `species`, `detail` — see `frontend/src/App.tsx:181–219`.
- Persistent chrome: `<FiltersBar/>` (top), `<SurfaceNav/>` (tablist), `<main/>`, `<footer/>` with Credits → `<AttributionModal/>` (App.tsx:155–256).
- Skip-link to feed (App.tsx:116–131); main has `tabIndex={0}` for scrollable-region keyboard access (App.tsx:169–179).
- Live at bird-maps.com; API at api.bird-maps.com (CORS-enabled JSON).

## Captured evidence (use these in findings)
Path: `tmp/redesign-analysis/screenshots/{local,prod}/{desktop,mobile}/`
- `01-map-default.png` — map landing
- `02-feed.png` + `02-feed-fullpage.png`
- `03-species-search.png`
- `04-species-detail.png` + `04-species-detail-fullpage.png`
- `05-attribution-modal.png`
- desktop-only: `06-map-notable-30d.png` (notable filter + 30d window)
- console logs: `screenshots/{local,prod}/console-map-desktop.log`

## Investigation areas (one per investigator)
1. Visual design system & token inventory — UI/Visual
2. Information architecture, navigation, URL state — Architecture
3. UX flows, density, friction (mobile + desktop) — Mobile/UX
4. Brand, voice, content, metadata — Content
5. Accessibility, motion, performance design surface — A11y/Perf

## Constraints binding all investigators
- Cite **file:line** or **capture filename** for every claim. No "feels like".
- Cover all 4 surfaces × 2 viewports = 8 cells, or explicitly say why a cell is N/A.
- This is **analysis**, not design. Do not propose a redesign. Identify what a designer needs to know and respect.
- Output goes to `tmp/redesign-analysis/funnel/phase-1/area-{N}-{slug}.md` BEFORE returning.

## Pre-existing artifacts to consult (not re-create)
- `docs/analyses/2026-04-20-frontend-map-analysis/` — prior frontend map analysis
- `docs/specs/2026-04-16-bird-watch-design.md` — full system architecture spec
- `docs/plans/2026-04-22-plan-7-map-v1.md` — map v1 design decisions

## Quality criteria (committed up front)
- Evidence strength 30%
- Surface × viewport completeness 25%
- Actionability for design brief 20%
- Nuance / trade-off recognition 15%
- Clarity for designer audience 10%

## Non-goals (do not drift into)
- Designing anything; choosing tech (Tailwind/CSS-in-JS/etc.); changing map behavior; backend/infra concerns; feature additions; prioritization or estimation.
