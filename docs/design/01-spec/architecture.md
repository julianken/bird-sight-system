# Architecture

The 30,000ft view of the redesign. For specific contracts see the other files in this folder.

## Layered structure

The redesign sits on top of three layers, ordered bottom-up:

1. **Token layer** (CSS custom properties) — primitive → semantic → component, with `[data-theme]` for light/dark. See [`tokens.md`](./tokens.md).
2. **Primitive layer** (5 React components) — `<StatusBlock>`, `<Photo>`, `<FamilySilhouette>`, `<ClusterPill>`, `<FilterSentence>`. See [`components.md`](./components.md).
3. **Surface layer** (4 screens) — feed, map, species, detail. Composes primitives.

Persistent chrome wraps the surface layer: header (wordmark + nav + filter trigger + attribution + theme toggle) on top, optional bottom-tab bar on mobile, no footer.

## Surface system

Four surfaces share the persistent chrome:

| Surface | URL | Default | Composition |
|---|---|---|---|
| `map` | `/?view=map` (also `/`) | **home route** | Header, context strip (lede + filter sentence + freshness meta), full-bleed MapLibre canvas, `<FamilyLegend>` overlay (collapsed mobile by default), bottom-tab on mobile |
| `feed` | `/?view=feed` | — | Header, context strip, top-notable card-row, flat list of species rows |
| `species` | `/?view=species` | — | Header, context strip, hero `<SpeciesAutocomplete>`, results list |
| `detail` | `/?view=detail&detail=<code>` | overlay | Modal `<dialog>` desktop / bottom-sheet mobile; photo masthead, `<h1 id="detail-title">`, family label, phenology, Wikipedia prose |

Map is the home route — `DEFAULTS.view: 'map'` per [`url-state.md`](./url-state.md).

## Persistent chrome

Top header (both viewports):
- Left: wordmark `Bird Maps · Arizona` (no brand mark)
- Center (desktop only): `[Feed | Species | Map]` nav with active-tab accent underline
- Right: `[Attribution]` link → existing `<AttributionModal>`, `[Filters {n}]` trigger with badge, `[Theme toggle]` (☀ / ☾)

Mobile bottom tab bar: 3 tabs (`Feed / Species / Map`). No `Credits` tab — attribution moves to the header.

No footer in chrome. The existing `<footer role="contentinfo">` containing the Credits link is removed in Phase 6; the header `[Attribution]` button satisfies CC BY 3.0 §4(c) prominence.

## Detail-surface IA

Desktop: native `<dialog>` modal, photo-anchor masthead, ESC closes, `aria-labelledby="detail-title"`.

Mobile: bottom sheet with three snap points (peek/half/full):

- Peek (~96px): handle + photo thumb + species name + 1-line stat. Map remains live + interactive underneath. Sheet has `role="region"`.
- Half (60% of content area): adds family + phenology. Map still interactive.
- Full (≈100% − 8px): adds Wikipedia prose. Map gets `pointer-events: none` and `inert`. Sheet flips to `role="dialog" aria-modal="true"`.

The sheet is NOT a `<dialog>` element — `<dialog>` is modal-only by definition; the peek/half states require a non-modal contract that lets the map underneath stay interactive. See [`accessibility.md`](./accessibility.md) for full role-switching details.

## Light / dark mode

`[data-theme="light|dark"]` attribute on `<html>`, persisted in `localStorage`. `prefers-color-scheme: dark` is the **initial** default for first-time visitors only — after first load, the user's explicit choice persists.

The map basemap also swaps with mode (positron in light → dark-matter or carto-dark in dark). The basemap swap is a user-visible change that demands a manual signal — that's why `[data-theme]` is the mechanism, not `prefers-color-scheme` alone.

To prevent FOUC, an inline blocking `<script>` in `index.html` reads `localStorage.theme` (or `matchMedia` fallback) and sets the attribute pre-paint.

> **Dark basemap is gated on G7/G8** — the family palette must clear WCAG 1.4.11 (3:1) against dark basemap tiles before dark mode promises render. If G8 fails, ship light-only first. See [`open-questions.md`](./open-questions.md).

## Cross-cutting structures

### `frontend/src/config/`

A new top-level module for runtime parameters, taxonomies, and lookup tables that drive visual or behavioral branching:

- `config/region.ts` — `REGION_LABEL` (e.g. "Arizona"). Source of truth for wordmark + lede region claim.
- `config/cluster.ts` — `CLUSTER_TIER_BOUNDARIES`, `clusterTier(count)`. Shared between React `<ClusterPill>` and MapLibre layer config.
- `config/family-palette.ts` — `FAMILY_PALETTE` lookup, `getFamilyChannel(code)` returning `{fill, on}`. AA-paired in unit tests.
- `config/filter.ts` — `FILTER_SENTENCE_DEBOUNCE_MS`, `FILTER_SENTENCE_CLEAR_HOLD_MS`.
- `config/freshness.ts` — `FRESHNESS_FRESH_MAX_MS`, `FRESHNESS_RECENT_MAX_MS`, `FRESHNESS_STALE_MIN_MS`.

These are imported wherever the parameter is consumed — no duplication in component bodies, no parallel CSS custom properties for parameters that need contrast pairing or threshold logic.

### Single-source-of-truth motion

`frontend/src/styles/motion.css` is the single source of truth for `prefers-reduced-motion`. No per-component `@media (prefers-reduced-motion: reduce)` rules elsewhere. MapLibre is the one exception (JS-side) — see [`motion.md`](./motion.md).

### axe e2e contract

The redesign extends the existing e2e suite (`frontend/e2e/axe.spec.ts`, currently 13 covered combinations) with three new branches:

1. Detail dialog photo path — assert `dialog[aria-labelledby]` resolves; `document.activeElement === #detail-title`
2. Bottom sheet at full snap — assert `role="dialog"` + `aria-label` matches species name + map has `inert`
3. Cluster pill — assert `role="img"` + `aria-label` includes count

These ship in Phase 4 (detail) and Phase 3 (cluster pill) respectively.

## Out-of-scope for this redesign (v1)

Recorded explicitly so they don't drift in:

- New features (accounts, checklist submission, save-favorites)
- Backend changes (Read API, ingestor, schema all stable)
- Webfont introduction
- Map clustering math changes
- Stillness 3rd reduced-motion mode (deferred v1.1)
- Geolocation "near me" default (deferred v1.1)
- Cluster-manifest keyboard rail (deferred v1.1)
- Dark basemap if G7/G8 fail prototype gate

For the full non-goals list and pre-ship gates see [`open-questions.md`](./open-questions.md).

## Cross-references

- Decisions: [`../00-overview/decisions.md`](../00-overview/decisions.md)
- Implementation: [`../02-phases/`](../02-phases/) — Phase 0 ships URL state changes; Phase 1 ships token foundation; Phase 2 ships primitives; Phases 3–5 ship surfaces; Phase 6 ships voice + metadata.
- Research: [`../03-research/analysis-funnel-summary.md`](../03-research/analysis-funnel-summary.md), [`../03-research/critique-loops-summary.md`](../03-research/critique-loops-summary.md)
