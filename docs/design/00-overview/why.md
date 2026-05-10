# Why this redesign exists

## The site today

bird-maps.com shipped to production on 2026-04-19. It serves recent Arizona bird sightings from eBird through four surfaces (`feed`, `map`, `species`, `detail`), built as a React 18 + Vite 8 SPA with no router (URL state via query params), MapLibre 5 for the live map, and a thin Hono read-API. Backend stack is stable.

The site is functional, accessible, and fast. It works.

## What it isn't

- It has **no declared identity**. "bird-watch — Arizona" exists only in the browser tab `<title>`. No surface renders the brand name, no tagline explains the purpose, no About page exists.
- It has **no metadata**. 19 enumerated gaps: `<meta description>`, all OG tags, Twitter card, favicon, manifest, theme-color, canonical, JSON-LD. Every social unfurl on Slack/Twitter/iMessage degrades to a bare URL.
- It has **no design system**. Tokens exist (`tokens.ts`, CSS custom properties on `:root`), but no primitive layer between tokens and surfaces. 14 distinct copy+class pairs for loading/empty/error states, each surface improvising. 35+ hardcoded font-size literals across 7 distinct values, no scale.
- **State is invisible.** Filters silently apply across all surfaces with no global indicator. Loading and empty states render identical muted text on cream — a user can't tell working from finished. Error severity and visual treatment are inverted (component-level errors look more serious than the app-level error). Browser back is silently broken across all surfaces (`replaceState`-only at `url-state.ts:87`).
- **Mobile chrome consumes 21.9% of the viewport** before any content renders (measured: 185.1px). The FamilyLegend overlay then covers another 44.8% of the visible map — worst case 60.1% of mobile viewport is non-map.
- **No light/dark theme**, no reduced-motion policy, no consistent overlay strategy.

## Why this matters

These aren't isolated visual nits. They're the **deferred decisions** that the original implementation worked around. Every decision-completion unblocks 5–20 downstream improvements that can't proceed without it:

| Deferred decision | What it blocks |
|---|---|
| Voice / identity (Position A vs B vs C) | All 19 metadata gaps; onboarding copy; type register; social sharing |
| Detail surface IA (modal vs sheet vs subview) | Browser back; photo-anchor pattern; cold-load behavior |
| State vocabulary (`<StatusBlock>` primitive) | 14 distinct ad-hoc state pairs; map skeleton (730px of cream-on-cream); error severity inversion |
| Token architecture (3-tier vs flat) | Light/dark mode; type ramp; consistent surface theming |
| Filter-active indicator | Chrome compaction (any pattern that hides filters worsens silent global coupling without it) |

The redesign exists to make these decisions explicit, build the missing primitive layer, and ship a coherent visual identity ("Sky Atlas") on top of the resulting foundation.

## Who this is for

The chosen audience anchor is **casual / visual exploration** — someone who saw a bird and wants to look it up, or who's idly browsing for "what's been seen near me lately." The redesign should feel like a *place*, not a tool.

This is a design choice, not an audience finding. The actual user population is unsampled (PostHog runs in production but the dashboard hasn't been read; this is gate G1, deferred to Phase 6). If G1 returns an "engaged-birder" signature, the redesign's voice register softens via Position A++ refinement; the visual direction holds either way. See [`../03-research/pre-ship-gates/G1-audience.md`](../03-research/pre-ship-gates/G1-audience.md).

## What this redesign is NOT

- Not adding features (no accounts, no checklist submission, no save-favorites)
- Not migrating the basemap (OpenFreeMap stays for v1)
- Not introducing a webfont (system stack is the brand)
- Not changing map clustering math (only its visual rendering)
- Not changing the backend (Read API, ingestor, schema all stable)
- Not adding a `Stillness` 3rd reduced-motion mode in v1 (deferred to v1.1)

For the full non-goals list see the spec architecture file: [`../01-spec/architecture.md`](../01-spec/architecture.md).

## What "done" looks like

Six implementation phases ship in causal order:

- **Phase 0** — Pre-redesign engineering: `pushState`, `DEFAULTS.view='map'`, global `motion.css`, MapLibre easeTo guard *(plan written)*
- **Phase 1** — Token foundation: three-tier contract, `[data-theme]` mechanic, type ramp
- **Phase 2** — Design-system primitives: `<StatusBlock>`, `<Photo>`, `<FamilySilhouette>`, `<ClusterPill>`, `<FilterSentence>`
- **Phase 3** — Map surface: cluster pills, lede, family-legend revision
- **Phase 4** — Detail surface: modal desktop + bottom-sheet mobile, photo masthead
- **Phase 5** — Feed + species: top-notable card-row, search input visual contrast
- **Phase 6** — Metadata + voice: 19 gaps, structured data, voice rewrites

For the dependency graph and what unblocks what, see [`../02-phases/README.md`](../02-phases/README.md).

## How this directory is structured

This file (`why.md`) is the entry point. The full set:

- `decisions.md` — the canonical 16-row decisions table
- `visual-direction.md` — Sky Atlas in one page

For implementation: [`../02-phases/`](../02-phases/). For specific contracts: [`../01-spec/`](../01-spec/). For evidence: [`../03-research/`](../03-research/) or [`../05-archive/`](../05-archive/).
