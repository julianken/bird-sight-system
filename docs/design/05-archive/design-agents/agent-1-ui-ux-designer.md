# Design Agent 1: UI/UX Designer

## Thesis

Sky Atlas is directionally correct and the right call over the three alternatives — it earns its polish without leaning on nostalgia or texture tricks, and the day/night accent flip (sunrise orange → moon cyan) is genuinely elegant. But the current mockups treat Sky Atlas as a visual project when the user moments that would make someone want to return are almost entirely missing. The front door still lands on a list of rows with no orientation. The map skeleton is still 730px of nothing. The detail surface is beautiful but there is no path into it from a cold URL. The most underexplored user moment is the one that hooks casual explorers: the person who sees something interesting outside, pulls out their phone, and wants to know if anyone else has seen it near them recently. That person needs a landing moment, not a filtered feed of rows.

## Ideas

### Idea 1: "What's Out There Right Now" landing moment

Replace the current context strip ("3,842 sightings, 274 species · Updated 11 min ago") with a genuine lede — a single sentence in `--ts-hero` scale (32px / 800 weight / letter-spacing -0.8px) that reads like a newspaper dateline: **"274 species seen across Arizona in the last 14 days."** Below it, two secondary stats in `--ts-caption` (12px / `--text-muted`): "Most active region: Tucson Basin · 38 species today." This is Position B voice made physical — declarative, accurate, specific. It takes no new data (counts are already in the API response), costs ~20 lines of CSS, and gives a first-time visitor an immediate orientation before they touch a filter.

- **Inspiration / reference:** NYT Upshot lede treatment; weather apps that lead with a one-sentence condition summary before the hourly grid.
- **How this relates to Sky Atlas:** extends the existing `sa-context-title` block from "count" to "lede" — same CSS class, bigger ambition in the copy.
- **Risk / trade-off:** the lede goes stale if the copy is hardcoded; must be dynamic from API totals. Copy must be factually accurate — if Arizona coverage is incomplete, the claim must be scoped (e.g., "Southeast Arizona").

---

### Idea 2: Skeleton shimmer as a first-class brand moment

The map skeleton (730px desktop / 635px mobile of cream-on-cream) is the site's largest single user-facing surface and currently its most boring. Treat it as a micro-brand moment instead: a CSS `@keyframes` shimmer that travels from left to right across the skeleton using the Sky Atlas accent palette — a warm-orange glow at the leading edge (`rgba(245,133,59,0.12)`) fading to transparent. Duration: 1.4s, `timing-function: ease-in-out`, `iteration-count: infinite`. In dark mode the shimmer uses the moon-cyan at `rgba(109,184,212,0.10)`. Wrap the entire animation in `@media (prefers-reduced-motion: reduce) { animation: none; }` — the existing `--dur-slow: 350ms` token is not enough; this needs a keyframe, not a transition. Skeleton text stays but changes from "Loading map…" to the Position B copy: "Finding recent sightings…"

- **Inspiration / reference:** GitHub's PR diff skeleton; Linear's list skeleton.
- **How this relates to Sky Atlas:** consumes the `--dur-base / --dur-slow` tokens that are reserved but currently unused; uses accent colors already defined; requires the `prefers-reduced-motion` guard the analysis calls mandatory for any new motion.
- **Risk / trade-off:** first motion CSS in the entire codebase — sets a precedent. If the shimmer is too prominent it feels like a loading spinner that never resolves. Keep luminance difference subtle (opacity ≤ 0.15).

---

### Idea 3: Feed rows as cards, not list items — on first row only

The feed is a flat list with no visual hierarchy between rows. The top row — the most recent notable sighting — deserves a different visual weight. Render the first notable sighting as a card with `background: var(--bg-surface); border-radius: 10px; border: 1px solid var(--border); padding: 16px; box-shadow: var(--shadow-sm)` and a `56px × 56px` silhouette thumb at `border-radius: 8px`. All other rows remain the current flat list treatment with `border-bottom: 1px solid var(--divider)`. This creates a natural focal point at the top of the feed — "the bird of the moment" — without changing the information architecture, the URL state, or any accessibility contract. The notable badge (`NOTABLE` in 9px / 800 weight / uppercase / accent background) stays on the card-row and on every flat notable row below it.

- **Inspiration / reference:** Twitter/X "pinned tweet" treatment; Hacker News front-page top story styling.
- **How this relates to Sky Atlas:** directly applies the `card-row` component already defined in `sky-atlas-system.html` — the component exists, it just isn't used at the top of the feed.
- **Risk / trade-off:** the "first notable" designation needs a deterministic rule (most-recent notable observation by timestamp, not by row index). If no notables are in the current filter set, fall back to first row with flat treatment — no card. Must not add a new data dependency.

---

### Idea 4: The species detail hero as a full-bleed "moment" — photo fills the fold

The current detail surface hero is 280px fixed height. On a 390×844 mobile screen with the bottom tab bar at 56px, that leaves 280 / (844 − 56 − 44) = ~37% of usable height — respectable but not immersive. Push the hero to `height: min(340px, 45vh)` so it scales with screen height. Within it, the photo `object-fit: cover` fills the full area. The gradient overlay shifts from `rgba(13,20,36,0.7)` to `rgba(13,20,36,0.5)` at the top — light enough to see the sky in the photo — and deepens to `rgba(13,20,36,0.85)` at the bottom where the title type sits. Species common name: `font-size: clamp(28px, 6vw, 42px) / font-weight: 800 / letter-spacing: -1px / color: white`. Scientific name: `font-size: 14px / font-style: italic / color: rgba(255,255,255,0.8)`. No change to the semantic HTML — only CSS values change. Works within the existing `<dialog>` modal frame.

- **Inspiration / reference:** Apple Music album detail; Airbnb listing photo treatment.
- **How this relates to Sky Atlas:** sharpens the existing hero treatment; uses `clamp()` for responsive scale that the current fixed-px `36px` heading misses at narrow viewports; `min(340px, 45vh)` prevents excessive height on landscape mobile.
- **Risk / trade-off:** `aspect-ratio: 4/3` CLS mitigation already in `styles.css:430–437` — this does NOT conflict because the hero is a full-bleed element, not the `max-width: 480px` constrained photo. Must ensure the iNat photo load does not flash white before the gradient overlay renders — gradient lives on the parent element, not the `<img>`, so it renders immediately.

---

### Idea 5: Filter-active state as a sentence, not a badge

The existing analysis calls for a filter-active badge count (e.g., "Filters 2"). That solves the indicator problem but misses a voice opportunity. Instead, render the active filter state as a single generated sentence in the `sa-context` strip, in `--text-muted` at `13px`: "Showing notable sightings from the last 14 days." When no filters are active: "Showing all sightings from the last 14 days." This sentence is assembled from the 4 filter values in `DEFAULTS` from `url-state.ts:15–22` — zero new state required. The filter trigger button still shows a badge count for quick scanning; the sentence provides the readable explanation below the count headline. Both elements are in persistent chrome and update in sync.

- **Inspiration / reference:** Airbnb search results "X homes · Filters" pattern; Google Flights active-filter description.
- **How this relates to Sky Atlas:** uses the `sa-context-meta` slot (currently "RECENT · LAST 14 DAYS · NOTABLE ONLY") — this idea replaces that all-caps label with a readable sentence in mixed case, which is both more humane and more consistent with the "functional-reassuring" voice register the analysis documents.
- **Risk / trade-off:** the sentence must handle edge cases: all 4 filters active, 0 filters active, family filter + notable together (need conjunction grammar). A simple template handles the common cases; an escape hatch "Showing filtered results" covers the unusual combos. Do not attempt natural-language generation — template-driven only.

---

### Idea 6: The map popover as the site's "discovery moment"

The map popover on cluster tap (shown in the dark-mode mockup: "JUST SEEN · Vermilion Flycatcher") is the highest-delight interaction surface in the app — a serendipitous "I didn't know this was here" moment. The current mockup renders it as a card with name, sci name, location, and a CTA link. Sharpen it with three additions: (1) A silhouette SVG from the DB at `32px × 32px` `fill: var(--accent)` left-aligned next to the common name — the silhouettes already exist from `/api/silhouettes`, they just aren't used in the popover today. (2) A "×N seen today" micro-stat in `font-size: 12px / --text-muted` below the scientific name — already in the observation data. (3) An animation on popover entry: `transform: translateY(8px) → translateY(0); opacity: 0 → 1; duration: 200ms; easing: cubic-bezier(0.34,1.56,0.64,1)` (slight overshoot spring). The spring makes the popover feel like it "arrives," not just "appears." Wrapped in `prefers-reduced-motion` guard as required.

- **Inspiration / reference:** Airbnb map pin popover spring animation; Google Maps "Info window" slide-in.
- **How this relates to Sky Atlas:** extends an already-designed component; adds the silhouette asset that exists in the DB but is missing from the popover; the `200ms` timing matches `--dur-fast` already defined.
- **Risk / trade-off:** `cubic-bezier(0.34,1.56,0.64,1)` exceeds `transform: scale(1)` momentarily — check that the popover doesn't clip against the map canvas edge. Silhouette fetch is a new dependency for the popover (currently it only uses observation data). Can be avoided by inlining the silhouette as a CSS mask or using a generic bird shape as fallback.

---

### Idea 7: "Near me" as the map's default verb on mobile

On mobile, the first thing a casual birder wants is "what's near me" — not "what's in all of Arizona." The Sky Atlas mockups show the full Arizona map as the default. Propose an alternative first-paint behavior: on mobile, if `navigator.geolocation` is available, prompt once (native browser prompt, no custom UI required) and if granted, fire `map.flyTo({ center: [lon, lat], zoom: 10, duration: 350 })` using the existing MapLibre `easeTo` pathway. If denied or unavailable, fall back to the current Arizona-centered default. The prompt copy fits in the `sa-context` strip: "Showing sightings near you — tap Map to explore all of Arizona." This costs approximately 12 lines of JavaScript in `MapCanvas.tsx` — the geolocation API is native, no library needed. The flyTo uses the existing `easeTo` wrapper (with the `prefers-reduced-motion` guard added as per Recommendation 3 in the analysis). No new UI component is required.

- **Inspiration / reference:** Weather apps (Weather.com, Yr.no) that default to current location; Yelp's "Near me" default search.
- **How this relates to Sky Atlas:** this is a UX behavior, not a visual direction — orthogonal to the Sky Atlas palette. But it radically changes the first-paint user moment for the audience most likely to be "saw something, want to find it" — the casual mobile user.
- **Risk / trade-off:** the geolocation prompt is intrusive if triggered without context — must not fire on first load with no explanation. The `sa-context` strip copy provides that context. If the user's location is outside Arizona (tourist, traveling), the map pans to an empty region — need a guard (`if lat/lon within Arizona bounding box`). This is a one-decision scope-expand: does bird-maps.com want to know where the user is? If the answer is "not yet," this idea is premature.

---

## One bold direction

The current redesign treats the four surfaces as peers with a shared chrome. A bolder frame: make **the feed the editorial surface and the map the exploration surface** — and signal that distinction at the visual level. The feed gets the Sky Atlas newspaper lede treatment (Idea 1), card-row for top notable (Idea 3), and the filter-as-sentence context strip (Idea 5). The map gets the full-bleed immersive treatment: the header collapses on mobile to just the brand mark + filter trigger (no nav) and the map fills from that header to the bottom tab bar with no intermediate chrome. Switching from Feed to Map is not switching views — it is switching modes of engagement, like switching from reading the paper to walking outside. The visual difference between these two modes (typographic vs. cartographic) earns the sky-atlas name more fully than any individual component change.
