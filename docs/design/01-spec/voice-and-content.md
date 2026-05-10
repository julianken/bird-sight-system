# Voice & content

Position B voice (declarative-direct), the lede contract, the freshness label state machine, and accent discipline. Phase 6 ships these systematically; the contracts here are the spec they implement.

## Voice register — Position B

The chosen voice is **opinionated utility** in the BirdCast tradition: a single declarative claim about what the site is, kept narrow and accurate. The first-load value proposition is one sentence:

> "Recent Arizona bird sightings, updated in real time from eBird."

This sentence (or a templated variant — see [Lede contract](#lede-contract) below) is the page's primary truth claim. It appears in:

- `<title>` — "Bird Maps · Arizona — Recent bird sightings from eBird"
- `<meta name="description">` — full first-load sentence
- OG / Twitter description — same
- Surface lede on map / feed / species — variant per surface

The voice should match the existing copy register on the site today: **functional-reassuring**. No exclamation marks, no apology language, no editorial flourish. Position B doesn't mean editorial; it means *named*.

> The 14 visible strings on the existing site (loading copy, error copy, empty states, attribution prose) have already coalesced into this register without it being declared. Phase 6 keeps them and adds metadata + lede in the same register.

### What Position B is NOT

- Not "we love birds and we hope you do too" (that's mission/Position C — structurally unavailable on this product)
- Not "the most beautiful Arizona birding experience" (editorial/marketing — overpromises)
- Not "comprehensive bird database" (false claim — the site is a recent-observations viewer, not a database front-end)

The Position B claim is bounded and verifiable: recent (last 14 days by default), Arizona, eBird-sourced, real-time-ish. Each adjective survives scrutiny.

## Lede contract

The lede is the first-screen sentence that appears in the context strip below the chrome on map / feed / species surfaces. It's a **runtime-evaluated truth claim** evaluated in priority order:

| Priority | Trigger | Template |
|---|---|---|
| 1 | Zero results from current filters | "No sightings match your current filters." |
| 2 | Single species selected (`speciesCode`) | "{N} sightings of {commonName} in {REGION_LABEL} in the last {period}." |
| 3 | Family filter active (`familyCode`) | "{N} species of {familyName} seen across {REGION_LABEL} in the last {period}." |
| 4 | Default (no narrowing filter) | "{N} species seen across {REGION_LABEL} in the last {period}." |

Stale data (ingestor lag > threshold from `frontend/src/config/freshness.ts`) drops the period clause: "{N} species seen across {REGION_LABEL}." — and the freshness label below escalates to "Stale" state.

`REGION_LABEL` and the freshness threshold live in `frontend/src/config/`. Region is a single export constant; freshness is three thresholds (fresh, recent, stale).

### Templates are explicit, not generative

Phase 5 component code branches through the 4 templates literally. There is no string-template engine, no NLG. The 4 cases above cover every (filter, freshness) tuple in `useUrlState`.

If a future filter combination produces a sentence that doesn't read well (e.g., family + species both set), the response is to expand the template list explicitly — not to introduce template grammar. Hand-written copy in 4–8 deterministic branches is the right level of abstraction.

## Freshness label state machine

The "Updated 11 min ago · Source: eBird" meta line below the lede is a state machine over `meta.freshest_observation_at` from the read API.

| State | Trigger | Visible copy |
|---|---|---|
| `fresh` | age ≤ 30 min | "Updated 11 min ago · Source: eBird" |
| `recent` | age ≤ 6 h | "Updated 2 h ago · Source: eBird" |
| `stale` | age > 6 h | "Last updated 9 h ago · Source: eBird" |
| `error` | ingestor error / Read API unavailable | "Source unavailable · check back soon" |

Thresholds live in `frontend/src/config/freshness.ts`:

```ts
export const FRESHNESS_FRESH_MAX_MS = 30 * 60 * 1000;   // 30 min
export const FRESHNESS_RECENT_MAX_MS = 6 * 60 * 60 * 1000; // 6 h
// stale = anything older than recent threshold
```

The Read API exposes `meta.freshest_observation_at` via `MAX(inserted_at)` on the observation table. Frontend computes age client-side; relative time strings via existing `formatRelative` utility.

In `error` state, the lede + freshness label work together to surface the problem without crashing the surface — `<StatusBlock state="error">` does not need to fire if the data is merely stale; the lede + label communicate it.

## Accent discipline

Subtractive. Orange (light, `--color-decision-point: #f5853b`) / cyan (dark, `--color-decision-point: #6db8d4`) appears ONLY at:

| # | Site | Element | Notes |
|---|---|---|---|
| 1 | Active SurfaceNav tab indicator | `::after` underline on `.surface-nav-tab.active` | desktop only |
| 2 | Filter badge background | `.filter-badge` | the count circle next to "Filters" |
| 3 | Focus halo outline | every focused interactive element via `:focus-visible` | brand flourish via WCAG 2.4.11 |
| 4 | Active phenology bars | `.phen-bar.active` | the months when the species is most active |
| 5 | NOTABLE meta-label | `.feed-card-meta` for top notable card-row | uses `--color-accent-notable-fg`, NOT `--color-decision-point` |
| 6 | Primary CTA | "Show on map", "Open detail", and similar | rare; if added |
| 7 | Filter-sentence emphasis | `.filter-bullet` inside `<FilterSentence>` | reader-action-confirming, narrative surface |
| 8 | Active mobile bottom-tab | `.mobile-tab.active` color | replaces SurfaceNav underline on mobile |

### Explicit exclusion

Map cluster popover "Open species detail →" CTA is `var(--color-text-body)` with `text-decoration: underline`. It is a link affordance, not a primary CTA. Critique loop 1 K2 specifically called out this site as a v3 mock violation; v4 fixed it.

### Notable vs accent — separate tokens

`--color-accent-notable-fg` (existing — preserve) and `--color-decision-point` (new) are **distinct tokens** even when their dark-mode values share hue (`#f5853b`). Component code MUST reference `--color-accent-notable-fg` for NOTABLE labels, never `--color-decision-point`. The two are not aliased.

A stylelint guard prevents accidental aliasing:

```bash
grep -rE 'var\(--color-decision-point\).*notable' frontend/src/
# Expected: 0 matches
```

### Why subtractive

Color carries meaning. When accent appears, something is interactive. The existing site uses the family-color palette (7 earth tones) as data encoding AND chrome accent (amber-ish notable token), which made the family palette compete with chrome decisions. Sky Atlas separates: the family palette is data; the decision-point accent is action; the notable token is attention-call. Three distinct semantic channels, no overlap.

The most common Sky Atlas mistake will be painting the lede's filter-bullet OR the popover meta-label OR a card-row in accent for narrative emphasis. Don't. The 8 enumerated sites are exhaustive; everything else stays muted text.

## Copy register inventory

For Phase 6's voice-pass rewrites, the existing 14 strings to update or preserve:

| String | File:line | Disposition |
|---|---|---|
| "Loading observations…" | `FeedSurface.tsx:96` | preserve |
| "No notable sightings in this window. Try widening the time window or turning off Notable only." | `FeedSurface.tsx:104` | preserve |
| "No observations reported today. Try expanding the time window." | `FeedSurface.tsx:106` | preserve |
| "No observations to show." | `FeedSurface.tsx:108` | preserve |
| "Start typing a species name to explore its recent sightings." | `SpeciesSearchSurface.tsx:54` | preserve |
| "Start typing a species…" | `SpeciesAutocomplete.tsx:279` | preserve |
| "Loading observations…" | `SpeciesSearchSurface.tsx:60` | preserve |
| "No recent sightings for this species in the current window." | `SpeciesSearchSurface.tsx:66` | preserve |
| "Loading species details…" | `SpeciesDetailSurface.tsx:201` | preserve |
| "Could not load species details" | `SpeciesDetailSurface.tsx:207` | preserve |
| "Couldn't load bird data" + raw `error.message` | `App.tsx:146–148` | **rewrite** — replace raw `error.message` with crafted copy |
| "Couldn't load silhouette attributions — try again later." | `AttributionModal.tsx:333` | preserve |
| "Loading silhouette attributions…" | `AttributionModal.tsx:337` | preserve |
| "Skip to species list" | `MapSurface.tsx:143` | preserve |
| "Map failed to load" | `MapSurface.tsx:128` | preserve |
| "Bird families in view" | `FamilyLegend.tsx:175` | preserve (already on register) |

All preserved strings already match Position B register. Phase 6 adds:

- Metadata `<meta>` strings (description, OG, Twitter)
- Lede templates (4 variants)
- Freshness label state copy (4 states)
- Filter sentence template
- Wordmark `aria-label` ("Bird Maps Arizona — home")

## Phase that ships voice + metadata

[Phase 6](../02-phases/phase-6-metadata-voice.md). Lede contract and accent discipline land earlier (lede in Phase 5, accent enforced from Phase 1's token migration), but the voice-pass + metadata gap closure is Phase 6.

## Cross-references

- Tokens (decision-point vs notable): [`tokens.md`](./tokens.md)
- Components (`<FilterSentence>` template): [`components.md`](./components.md)
- Open question G1 (audience profile gates voice register): [`open-questions.md`](./open-questions.md)
