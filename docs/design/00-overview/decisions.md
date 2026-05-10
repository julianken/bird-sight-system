# Decisions table

Every commitment behind the Sky Atlas redesign, with traceable source. This is the single canonical version — when a decision changes, update this file *and* the relevant spec section in [`../01-spec/`](../01-spec/).

## Locked decisions

| # | Decision | Value | Source / Rationale |
|---|---|---|---|
| 1 | Visual direction | **Sky Atlas** — editorial, photo-led, sky-day/night metaphor, single dramatic accent | brainstorm round 1; user choice over Sonoran / Studio / Topographic |
| 2 | Audience anchor | **Casual / visual exploration** — place, not tool | user choice; conditional on G1 (deferred) |
| 3 | Voice position | **Position B** (opinionated utility): "Recent Arizona bird sightings, updated in real time from eBird" | analysis Theme 1; closes 19 metadata gaps with one declarative claim |
| 4 | Home route | **Map** — `DEFAULTS.view: 'map'` in `frontend/src/state/url-state.ts:15–22` | resolves analysis stakeholder decision S4 |
| 5 | Filter-active indicator | **Badge + sentence** ("Filters [2]" + "Showing notable sightings from the last 14 days") | analysis Theme 2; required by every chrome compaction pattern |
| 6 | Detail overlay strategy | **Modal on desktop + bottom-sheet on mobile** (Apple Maps idiom) | iOS-style design agent; reuses existing native `<dialog>` from `AttributionModal.tsx:182–261` |
| 7 | Cluster palette | **Pills, not solid circles**; measured-contrast triad: Sky 8.2:1 / Sand 10.4:1 / Ember 5.1:1 against text-strong | a11y design agent; closes axe-canvas-excluded gap |
| 8 | Type system | **6-step system-font ramp** (11/13/15/17/22/34); no webfont; SF Pro / Segoe UI Variable / Roboto | iOS-style design agent; preserves perf budget |
| 9 | Brand mark | **Dropped — wordmark only** ("Bird Maps · Arizona") | dissent agent; family palette IS the system's identity |
| 10 | Loading/empty/error | **`<StatusBlock>` primitive**; flat skeletons + 2px sunrise progress bar | design-system + a11y agents; collapses 14 ad-hoc state pairs |
| 11 | Token architecture | **Three-tier** (primitive → semantic → component); `[data-theme="light\|dark"]` light/dark mechanic | design-system agent |
| 12 | Family palette | **JS-computed** lookup (`getFamilyChannel(familyCode)`); inline `style`; AA-paired `{fill, on}` | critique loop 2 K1; resolves 3-path mechanism ambiguity |
| 13 | Accent discipline | **Subtractive** — orange (light) / cyan (dark) at 8 enumerated decision points only | iOS + UX agents; critique loop 1 K2 enumerates the 8 sites |
| 14 | Photo treatment | **`<Photo>` primitive** with `priority` prop; full-bleed anchor on detail | critique loop 1 K5 (LCP); critique loop 2 K4 (boundary with `<StatusBlock>`) |
| 15 | Focus indicator | **Inverse-luminance halo** (2px outline + 2px gap); CSS `color-mix` for 3:1 against immediate surface | a11y design agent; brand flourish via WCAG 2.4.11 compliance |
| 16 | `pushState` for detail | **Pre-redesign engineering fix** (~40 LOC, ships in Phase 0); separate from visual redesign | analysis Recommendation 2 |

## Open decisions (deferred to specific phases or pre-ship gates)

| # | Decision | Status | Resolution path |
|---|---|---|---|
| 17 | G1 audience profile (PostHog) | Deferred — gates Phase 6 voice ship | 15-min PostHog dashboard read; if engaged-birder signature, fall back to Position A++ refinement |
| 18 | G2 region precision | Open | Inspect ingestor coverage; refine `REGION_LABEL` if `<100%` Arizona |
| 19 | G3 bundle baseline | Pending | `npm run build && du -sh frontend/dist` once before Phase 1 lands |
| 20 | G4 photo coverage | **Closed** 2026-05-09 — 91.1% coverage | `<Photo>` no-photo state is on hot path (~9% of detail opens); `family: FamilyCode \| null` typing required |
| 21 | G5 MapLibre easeTo reduced-motion | Closes in Phase 0 | Phase 0 Task 4 adds the guard |
| 22 | G6 iOS safe-area | Pending — gates Phase 4 mobile sheet | Physical iPhone X+ test; add `viewport-fit=cover` + `env(safe-area-inset-bottom)` |
| 23 | G7 family-color × basemap contrast | Pending — gates Phase 1 family-palette commit | Sample tile colors at worst-case zoom; verify WCAG 1.4.11 (3:1) |
| 24 | G8 dark basemap | Deferred to v1.1 | Prototype OpenFreeMap dark style against family palette before promising dark mode in marketing |
| 25 | Stillness (3rd reduced-motion mode) | Deferred to v1.1 | Phase 0 + Phase 1 cover OS-level reduced-motion; explicit user toggle waits |
| 26 | Geolocation "near me" default | Deferred to v1.1 | Feature scope; not a visual redesign concern |
| 27 | Cluster-manifest keyboard sidebar | Deferred to v1.1 | A11y improvement for map keyboard reach |
| 28 | Cold-load surface behind detail dialog | Resolved | With map as home route (S4), the cold-load underlying surface is always the map. Implicit. |

## Cross-references

- **Spec sections** that reference these decisions: see [`../01-spec/`](../01-spec/) — every decision is implemented in one or more spec files.
- **Phase plans** that ship these decisions: see [`../02-phases/`](../02-phases/) — Phase 0 ships #4, #16, #21; Phase 1 ships #11, #8; Phase 2 ships #10, #14; etc.
- **Research backing**: see [`../03-research/`](../03-research/) — analysis funnel, design agents, critique loops.
- **Open question detail**: see [`../01-spec/open-questions.md`](../01-spec/open-questions.md) for full G1–G8 status table with cost + resolution path.

## Update protocol

When a decision changes:
1. Update the row in the table above with the new value and dated rationale
2. Add a brief footnote at the bottom of this file linking to the prior version (e.g., "2026-06-01: decision #6 changed from modal+sheet to sheet-only because [...]" with link to a snapshot in `05-archive/`)
3. Update the corresponding spec section in [`../01-spec/`](../01-spec/)
4. If the change affects a phase, update [`../02-phases/`](../02-phases/) and the relevant plan in `docs/plans/`

Do NOT delete rows. The table grows over time as a decision log.
