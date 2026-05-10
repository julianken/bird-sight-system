# Sky Atlas Redesign — Locked Decisions (post-brainstorm)

This is the canonical decision state at the start of the critique loops. Everything below has been agreed on or implicitly approved through brainstorm v3 mocks.

## Decisions made

| Decision | Value | Source |
|---|---|---|
| Visual direction | Sky Atlas (over Sonoran / Studio / Topographic) | brainstorm round 1 |
| Audience anchor | "Visual / casual exploration" — place, not tool | brainstorm clarifying |
| Voice position | **Position B** (opinionated utility): "Recent Arizona bird sightings, updated in real time from eBird" | analysis Theme 1 + lede in v3 |
| Home route | **Map** (`DEFAULTS.view='map'` in `frontend/src/state/url-state.ts:15–22`) | resolves S4 from analysis |
| Filter-active indicator | **Badge + sentence** ("Filters [2]" + "Showing notable sightings from the last 14 days") | v3 mocks |
| Detail overlay strategy | **Modal on desktop + bottom-sheet on mobile** (Apple Maps idiom; reuses `<dialog>` from `AttributionModal.tsx:182–261`) | A4 |
| Cluster palette | **Pills, not solid circles**; measured-contrast triad: Sky 8.2:1 / Sand 10.4:1 / Ember 5.1:1 against text-strong | A2/A3/A4 |
| Type system | **6-step system-font ramp** (11/13/15/17/22/34); no webfont; SF Pro / Segoe UI Variable / Roboto | A4 |
| Brand mark | **Dropped — wordmark only** ("Bird Maps · Arizona") | A5 |
| Loading/empty/error | **`<StatusBlock>` primitive**; flat skeletons + 2px sunrise progress bar (no shimmer) | A2/A3/A4 |
| Token architecture | **Three-tier contract**: primitive → semantic → component; `[data-theme="light\|dark"]` on `<html>` for mode toggle | A2 |
| Family palette | **Role-channel** (`--channel-family-fill` + auto-paired `--channel-family-on` for AA contrast); shape-paired in legend (circle/square/pentagon/diamond) | A2/A3 |
| Accent discipline | **Subtractive** — orange (light) / cyan (dark) ONLY at decision points: active tab indicator, filter badge, focus halo, active phenology bars, NOTABLE meta-label, primary CTA | A4/A1 |
| Photo treatment | **`<Photo>` primitive** with built-in `loading="lazy"` / `srcset` / attribution overlay; full-bleed anchor on detail surface | A2/A4 |
| Focus indicator | **Inverse-luminance halo** (2px ring + 2px outline-offset gap); CSS `color-mix` for 3:1 against immediate surface | A3 |
| Newspaper lede | "274 species seen across Arizona in the last 14 days." — replaces count-style subhead | A1 |
| `pushState` for detail | **Pre-redesign engineering fix** (~40 lines, Option D from analysis Recommendation 2); ships before visual redesign begins | analysis |

## Decisions deferred (recorded as open questions, not blockers)

| Open question | Status | Resolution path |
|---|---|---|
| G1 audience (PostHog read) | unsampled | 15-minute dashboard read before ship; if engaged-birder signature returns, re-evaluate Position B + photo-led identity |
| Photo coverage (no audit) | unaudited | One SQL query: `SELECT count(*) filter (photo_url IS NOT NULL)/count(*)::float FROM species`; if <90%, add silhouette-default fallback |
| Stillness 3rd mode | deferred to v1.1 | current v1 ships Day/Night only |
| Dark-mode basemap | unverified | OpenFreeMap dark style needs prototype-gate validation against family palette; if fails 3:1 against earth tones, ship light-only first |
| Geolocation "near me" default | deferred | feature scope, not visual; v1.1 |
| Cluster-manifest keyboard rail | deferred to v1.1 | a11y improvement for map keyboard reach |
| Cold-load surface behind detail dialog | deferred | default to Map (since map is now home route, this is automatic — no change needed) |
| No-photo fallback state | needs design | photo-optional Sky Atlas — silhouette default at hero scale + family-color tint |

## Mocks reference

- `tmp/redesign-analysis/funnel/phase-4/analysis-report.md` — full analysis context
- `.superpowers/brainstorm/1539-1778381400/content/sky-atlas-v3.html` — v3 mocks (current state)
- `tmp/redesign-analysis/brainstorm-agents/agent-{1..5}-*.md` — 5 design agents' ideas

## What the critique loops should NOT re-litigate

These are settled. Don't propose returning to:
- Voice position A vs B vs C (B is chosen)
- Direction A vs B vs C vs D (Sky Atlas is chosen)
- Modal vs sheet for detail (modal desktop + sheet mobile is chosen)
- Whether to add a webfont (no is chosen)
- Whether to keep brand mark (dropped is chosen)
- Cluster bubbles vs pills (pills is chosen)
- Map vs feed home route (map is chosen)
- Whether to ship `<StatusBlock>` (yes is chosen)

What the loops SHOULD surface: kinks, contradictions, missing edge cases, undefined states, implementation risks, accessibility gaps, layout failures at unconsidered viewports, token-system clashes, narrative inconsistencies between mocks. Real issues only — premise-rejection is out of scope.
