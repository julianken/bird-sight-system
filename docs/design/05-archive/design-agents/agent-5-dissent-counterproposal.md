# Design Agent 5: Dissent & Counter-Proposals

## Thesis

The consensus around Sky Atlas treats a stack of unmeasured assumptions as load-bearing premises and then designs against them. The most consequential of these — that the audience is "casual / visual," that photo-led identity is achievable on this dataset, that the map is the right front door, that "opinionated utility" (Position B) is both available and desirable — were chosen as framing, not derived from evidence. The analysis report itself names G1 (audience profile, **unsampled**) as "the single highest-leverage piece of missing information"; the brainstorm proceeded anyway. Sky Atlas is the *visually most ambitious* direction of the four, which means it has the *highest blast radius* if any of those upstream assumptions is wrong. The most likely failure mode is not "Sky Atlas executes badly"; it's "Sky Atlas executes beautifully against the wrong target." Several lower-cost, lower-risk directions were closed off prematurely. Pick your battles — but pick them on the assumptions, not the surfaces.

## Counter-Ideas

### Counter 1: The "casual / visual exploration audience" is a frame, not a finding

**The assumption:** Sky Atlas's photo-led, magazine-grade identity is justified by the implied audience of a casual visitor who arrives without context and needs a polished, orienting experience. This audience is named throughout the consensus.

**Why the assumption is plausible-but-fragile:** The analysis report's Section G ("Confidence Assessment") explicitly lists audience profile as "completely unsampled" and "low confidence." Theme 1 Finding 1.2 recommends Position B over A on the *condition* that "Position A's cost is low if audience is expert and self-orienting; high if general public." The brainstorm flips that conditional from "if" to "is." A 15-minute PostHog read could resolve it; nobody did the read. Meanwhile, the existing site has a real user base whose mental model is Position A (neutral utility) — if those users are predominantly returning birders checking recent sightings (a plausible inference from a narrowly-scoped, no-account, no-onboarding utility), then a magazine-grade redesign optimizes for a hypothetical visitor at the cost of the actual one. This is the classic redesign anti-pattern the analysis report's "blind spot #1" warned about: existing users have switching costs the analysis cannot measure.

**Alternative direction:** Hold the redesign at *Position A++ refinement* until G1 closes. Same accessibility wins, same `pushState` fix, same loading-state primitive, same chrome compaction — but voice and visual register stay close to the existing utility. Ship Sky Atlas as a post-refinement *option*, not the chosen direction.

**What would make me update toward consensus:** A 15-minute PostHog read showing >40% bounce on first session, mobile-dominated traffic, low return rate, short sessions. That's a casual-visitor signature and Sky Atlas earns its ambition. Until then, the audience is a guess in expensive clothing.

---

### Counter 2: Sky Atlas lives or dies on photos that don't exist

**The assumption:** "Hero photos lead every surface." The detail surface mockup centers a 280px photo masthead. The feed mockup gives every row a 56px thumbnail. The system poster makes "photo treatment" one of five primitives.

**Why the assumption is plausible-but-fragile:** This codebase has no audited photo coverage. The analysis report (Theme 1, Theme 4) repeatedly notes that descriptions are 85% covered (and that's the *easy* one — Wikipedia text); photo coverage from iNat is undocumented. Memory note `feedback_ingestor_wikipedia_404` shows the ingestor has had to clear stale attribution_url on 404s — coverage is brittle and changes over time. The species detail surface today renders **without a photo** as a documented, axe-validated state (`axe.spec.ts` covers "species detail no-photo desktop + mobile" — analysis report Finding 5.2). Sky Atlas mockups never show that state. The feed mockup uses gradient placeholder thumbnails that *also don't exist as a system primitive* in the current codebase — every feed row would need a deterministic, attractive, accessible fallback for the missing-photo case, designed and contrast-checked, for arbitrarily many species. The feed has 344 rows in the prototype-gate spec; if photo coverage is, say, 60%, that's ~138 rows of placeholder. The "magazine-grade" claim collapses on the long tail.

**Alternative direction:** Photo-optional Sky Atlas. The hero is a *colored panel keyed to family palette + silhouette*, with photo as enhancement when present. Reverses the polarity: the system has to look great *without* photos and is rewarded *with* them. This also dodges the LCP cost of the photo masthead (no `loading="lazy"` on the existing detail photo per Finding 5.3 — adding one above the fold makes it worse).

**What would make me update toward consensus:** A coverage audit. `SELECT count(*) filter (where photo_url is not null) / count(*)::float FROM species` plus a histogram of photo coverage by family. If coverage is >90% with no long-tail dropoff, photo-led is defensible. If it's 65% or family-skewed, photo-led is a trap.

---

### Counter 3: Changing the front door was never argued for

**The assumption:** The Sky Atlas surfaces present the Map as the headline surface (largest mockup, most detailed, gets the dramatic context bar "3,842 sightings, 274 species"). The mobile bottom-tab bar shows Map active. This implies a front-door shift.

**Why the assumption is plausible-but-fragile:** `url-state.ts:15–22` defines `DEFAULTS.view='feed'` — the existing front door is the Feed. The analysis report flags this as **stakeholder decision S4** ("Is the map or the feed the intended front door?") and explicitly states it's unresolved. The Sky Atlas surface mockups quietly answer S4 in favor of map without the question being adjudicated. This matters because: (a) the map is by far the slowest surface (730px loading skeleton, MapLibre tile fetch, family-legend localStorage hydration); making it the cold-load surface punishes every first-time visitor with the worst LCP in the app; (b) returning users with `?view=feed` bookmarks would break expectation; (c) the entire Theme 3 problem (FamilyLegend overlay = 44.8% of mobile main) compounds when the map is what people land on first.

**Alternative direction:** Keep `DEFAULTS.view='feed'` and design the Feed as the hero surface. Sky Atlas's editorial voice arguably suits a Feed of named recent sightings *better* than it suits a map of clustered counts — a feed is naturally narrative, a map is naturally analytic. The Map becomes the second click, with full Sky Atlas treatment when reached. This also matches the brand-voice claim ("Recent Arizona bird sightings, updated in real time from eBird") which is fundamentally a feed claim, not a map claim.

**What would make me update toward consensus:** Explicit S4 commitment with a written rationale. Right now the answer is implicit in mockups and that's exactly how front-door decisions get made wrong.

---

### Counter 4: Position B may be the wrong voice for the actual user

**The assumption:** The analysis recommends Position B (opinionated utility, BirdCast-style); Sky Atlas materializes it via the bold "RECENTLY SEEN," the orange accent, the editorial subheads ("3,842 sightings, 274 species").

**Why the assumption is plausible-but-fragile:** Position B is recommended over A on the basis of *metadata gap closure* — but Position A's claimed cost (the 19 metadata gaps) is also closeable under Position A++ with neutral, factual metadata ("Recent bird sightings in Arizona from eBird. Updated hourly."). You can fill the 19 gaps without adopting BirdCast's editorial voice. Position B's *additional* claim — that the in-app voice should also become opinionated — is conflated with the metadata fix. They're separable. Meanwhile, Position B carries real risks: (a) the existing 14-string copy register is "functional-reassuring" (analysis Finding 5.1) and shifting it to editorial creates voice drift across 14 sites that need to be co-rewritten; (b) editorial voice raises the truth-maintenance burden — "Updated 11 minutes ago from eBird" is a claim that breaks the moment the ingestor lags; (c) regular users who built a mental model around the neutral framing now experience a tonal break for no functional gain.

**Alternative direction:** Position A++ — fill all 19 metadata gaps with neutral factual claims, leave the in-app copy register untouched, ship the same accessibility/state-invisibility/chrome work. Cheaper, lower-risk, fully reversible.

**What would make me update toward consensus:** Evidence that the existing voice register has a measurable cost to existing users (it doesn't — voice register is documented as *coherent*, just under-declared). Or a stakeholder commitment that the product *wants* opinion as a strategic choice — but then it's a product decision, not an analytical one.

---

### Counter 5: Dark mode may be structurally infeasible

**The assumption:** Sky Atlas ships with a dark-mode "Night" pane: `--bg-page: #0d1424`, moon-cyan accent, full surface parity with light mode.

**Why the assumption is plausible-but-fragile:** A coherent dark mode for a map app requires a dark *basemap*. Bird-maps.com uses OpenFreeMap (per CLAUDE.md memory note `chore(infra): remove unapplied map-v1 Cloudflare TF (live map uses openfreemap)`). OpenFreeMap's positron style is light-only by default; their public dark style ("dark") exists but its coverage and update cadence is community-driven. The Sky Atlas mockups paper over this with abstract gradient `sa-map-bg` tiles — they never show a real dark basemap with the family-color silhouettes overlaid. G7 in the gap inventory ("family-color palette worst-case contrast against basemap tiles") was unresolved against the *light* basemap; against a dark basemap it's an entirely new contrast problem. The 7 earth-tone family colors are tuned for cream backgrounds; on a near-black basemap several will fall below 3:1 (WCAG 1.4.11 non-text component minimum). "Recommission a Sky-Atlas-tuned family palette" (system poster footnote) implies a DB migration touching `data/family-color.ts` and historical observation rendering. That's not a design tweak, it's a backend change.

**Alternative direction:** Ship Sky Atlas light only. Defer dark mode to a Phase 2 once basemap migration (or OpenFreeMap dark verification) is done. This also means the system doesn't promise dark mode in marketing/social meta until it's real. Honesty about constraint > visual symmetry on a mockup poster.

**What would make me update toward consensus:** A working prototype of the live map with OpenFreeMap dark tiles and the actual family-color silhouettes overlaid, contrast-measured, at desktop and mobile zoom levels. Per the CLAUDE.md prototype gate: ≥344 rows, both viewports, real data. If that prototype renders cleanly and meets WCAG 1.4.11, dark mode is real. Until then it's a poster.

---

### Counter 6: A direction that wasn't considered — the dense-data / Bloomberg / scientific direction

**The assumption (by absence):** The four directions (Sonoran / Atlas / Studio / Topographic) span romantic → editorial → soft-modern → cartographic. None of them sits in the "dense, factual, instrument-panel" register that birders themselves use (eBird's actual interface, BirdCast's data-density, scientific paper figure layouts, Audubon's species accounts, BNA / Birds of the World).

**Why the omission is plausible-but-fragile:** All four directions are *aesthetic* directions; none is an *epistemic* direction. If the actual user is the engaged birder (G1, unsampled), what they want from a Position-B utility is more data per pixel, not more polish per pixel: numerical precision (counts, distances, observation timestamps to the minute), tabular legibility, sortable columns, data-dense map clusters with breakdown by family, phenology comparisons across species. The phenology bar in the Sky Atlas detail mockup is the only data-dense element in the whole system, and it's a single chart in a sea of editorial chrome. Tucson Bird Alliance (a real Arizona birding org cited in Iterator 1) is dense and factual, not magazine-grade. Sky Atlas is what a designer would build for someone *imagining* birders; "Bloomberg for birds" is what an actual birder might want.

**Alternative direction:** "**Data Atlas**." Same accessibility/chrome/state work as Sky Atlas, but visual register inverted: tabular feed (sortable columns: species / location / count / time / distance from viewer), phenology chart on every species (not just detail), per-cluster family breakdown panel, numeric tabular alignment everywhere (`font-variant-numeric: tabular-nums` already used in Sky Atlas mockups but only for time fields), no hero photo masthead. Voice: BirdCast-precise. Type: monospace for numerics, system stack for prose. Single accent earns its keep by marking *notable* observations only — never decorative. Dark mode is trivial because there are no photos to color-grade.

**What would make me update toward consensus (against this counter):** Evidence the audience is not engaged birders — i.e., G1 returning a casual-visitor signature.

---

### Counter 7: The brand mark is doing rhetorical work it can't deliver

**The assumption:** Every Sky Atlas surface mockup carries a 26px orange (light) / cyan (dark) brand mark — a rounded square with a clipped diamond inside it, paired with "Bird Maps · Arizona."

**Why the assumption is plausible-but-fragile:** Arguments against introducing a brand mark at all: (a) the existing site has *no* visible brand mark today and that absence is not listed in any of the 19 metadata gaps — those are favicon, OG image, manifest icon, Twitter card, etc. (all of which are *file-format* needs, not in-app rendered marks); (b) a rendered brand mark on every header is the kind of "logo on every page" decision that small utilities (BirdCast, Tucson Bird Alliance homepage cited in analysis) deliberately omit because the URL bar already brands the site; (c) the specific shape (diamond-in-square) reads as generic geometric AI-aesthetic — it neither references a bird, a map, Arizona, nor anything in the data; (d) it competes for visual weight with the family-color palette, which *is* the system's actual identity (every species, every cluster, every silhouette is family-colored). Adding a brand mark dilutes the signal of the family palette as identity.

**Alternative direction:** No brand mark in chrome. Wordmark only ("Bird Maps · Arizona" set in the type system). Favicon + OG image use the family-color palette directly — e.g., the 7 silhouettes arranged as a tile motif. The system's identity is its data, not a glyph.

**What would make me update toward consensus:** A brand mark that derives from the data (silhouette of an Arizona-iconic species; literal Arizona state outline; cardinal direction marker) and earns its placement by referencing something. The current diamond is decoration.

---

## One bold counter-proposal

**"Field Notebook"** — a fundamentally different visual direction premised on engaged birders, not casual visitors.

The mental model is the personal field journal: ruled paper, hand-tight typography, ink + watercolor wash, marginalia. The system uses a webfont *deliberately* (a humanist serif like Source Serif Pro for prose, JetBrains Mono for numerics) — but earns it by replacing the system-stack inconsistency with something the user actively wants to read. The map basemap is muted paper-tone with hand-drawn ecoregion boundaries. Family colors are unchanged (they already feel hand-mixed). Photos exist when they exist, captioned in the margin like a field guide plate. Phenology bars look like 12-month index strips. The feed reads like a continuous chronological journal entry, not a list of cards. Dark mode is "lamp on the desk at night" — warm cream text on near-black with a single orange tungsten-glow accent.

Why this matters as a counter to Sky Atlas: it answers the same goals (state visibility, chrome compaction, voice declaration, accessibility preservation) with a register that *amplifies* rather than papers over what bird-maps.com structurally is — a small, deliberate, scope-bounded utility for people who already care. It treats the user as an expert and the data as the subject, not the chrome. It costs less to ship (no photo pipeline dependency, no DB family-palette migration) and risks less if G1 returns a power-user signature. And it's distinctive in a way no "magazine-grade" template ever will be.
