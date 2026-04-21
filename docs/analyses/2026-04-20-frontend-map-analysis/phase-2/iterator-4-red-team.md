# Iteration: Red-Team Check on Phase 1 Convergences

## Assignment

Stress-test the Phase 1 convergences by steelmanning the opposition. All five
Phase 1 investigators converged on "the map design is broken, ditch it." This
iteration asks: is that genuinely true, or is it phase-0-primed groupthink? For
each of the three biggest convergences (plus one bonus), argue the strongest
counter-position, cite supporting and opposing Phase 1 evidence, and rate the
counter's credibility. Conclude with blind spots no Phase 1 investigator could
have caught.

No design proposals. Every claim cites a specific file, line, or Phase 1
finding.

---

## Findings

### Counter 1: "The SVG map is underexecuted, not inherently broken"

**Strongest counterposition.** Area 1 classifies five UX failures as *inherent
to the metaphor*, but four of those are actually undershipped engineering, not
thermodynamic limits of the polygon-with-badges idiom. Each has a well-known
solution that Julian has not yet applied. Three-Sky-Islands-same-colour
(Finding 2) is a one-line token change — PR #96 already landed the design-token
infrastructure. Label collision in expand (Finding 3) is what D3, deck.gl, and
every choropleth library in production solves with force-directed label
placement, leader lines, or on-hover tooltips; `BadgeStack.tsx:164-170` reserves
vertical space and explicitly admits horizontal was never budgeted, which
reads as "not attempted" rather than "impossible." Semantic anchor absence
(Finding 1) is an Arizona state outline plus nine region labels — neither
requires rewriting the map chain. "Spatial encoding misleading" (Finding 6) can
be partially defused by a legend, a basemap gesture, or a tooltip that says "by
region, not by location." The Sky Islands giant-grey-pip fallback (Finding 4)
could render a species list *inside* or *beside* the polygon rather than a
bloated overflow circle — `BadgeStack.tsx:189-258` is the fallback branch, ~70
LOC to rewrite. Put together, the critique is not "a polygon map cannot work
for AZ ecoregions"; it is "nobody has put two focused weeks into making this
one work."

**Evidence for the counter.**
- Area 1 itself concedes four of nine findings are "fixable within the
  metaphor": unkeyed colour legend (Finding 2), tap-target size (Finding 5
  second half), region clickability affordance (Finding 7), filter-bar
  vocabulary (Finding 9). That's half the failure surface by Area 1's own
  classification.
- Phase-0 packet §Loadbearing fact 2 lists three regions sharing
  `#B84C3A` — a direct data-side fix; Area 1 Finding 2 classifies this one as
  "fixable within the metaphor," and PR #96 (Area 2 Finding 4, design tokens)
  shows the infrastructure is already there.
- Area 2 Finding 1 documents the dragons as "completed debugging cycles" — each
  block is a solved problem. The rate of resolution per-PR has been high,
  suggesting another 2–4 focused weeks could close out most of them.
- Area 5 Finding 7 frames the death toll at 1,000 LOC DISCARD — which also
  means the fix-the-map path costs zero of that. Fix-in-place is strictly
  lower-LOC.

**Evidence against the counter.**
- Area 1 Finding 3 (the strongest phase-1 claim): *every* label in
  `bird-maps-sonoran-tucson-expanded.png` is illegible because 4 cols × 14-char
  names ≥ 34-unit pitch. A collision-resolving label layout that wants labels
  on the figure itself rather than a floating tooltip still runs into the
  geometry — the inscribed rect simply doesn't supply enough horizontal area
  for readable in-place labels without dropping badges-per-row to 1–2, at
  which point the grid isn't a grid. This is load-bearing; it is the
  single most persuasive piece of evidence that expand-view is structurally
  constrained.
- Area 1 Finding 6: the spatial encoding failure isn't a tooltip problem.
  A visitor who has used *any* dot-density or proportional-symbol map
  implicitly reads "circle at position X inside polygon Y means observation
  near position X." That inference is automatic. A disclaimer tooltip does not
  undo a pre-attentive visual interpretation — that's how cartographic reading
  works.
- Area 2 Finding 4: the churn rate is *not declining*. 8 of last 10 PRs
  were rendering fixes. "2 weeks of focused work" assumes the next 2 weeks
  behave differently from the preceding 8. The phase-0 packet explicitly
  frames this as a fatigue signal.
- Area 1 Finding 8 (overflow dominance, 301+ hidden species behind 8 pips):
  this is genuinely structural. The 12-badge cap is already a containment
  compromise; relaxing it pushes badges into regions too small to render them.

**Credibility: Moderate.**

Half of Area 1's findings really *are* fixable in the metaphor, and Area 2's
dragons-as-solved-problems framing is honest. If Julian put a focused two
weeks on labels + tokens + state outline + Sky Islands fallback rework, the UI
would look materially better. But the in-polygon label legibility geometry
(Finding 3) and the active-misdirection of spatial encoding (Finding 6) are
harder than "underexecuted" admits. The critique is real that the map has been
worked on incrementally rather than redesigned; the rebuttal is that even a
focused redesign within the metaphor hits bounded constraints that a non-map
UI simply doesn't have.

**What Phase 3 should do.** Incorporate as a caveat. If Julian *loves* the
map visually (blind spot #1 below), the synthesizers should not present
"ditch it" as the only path — they should frame it as "here is what a focused
2-week in-metaphor rescue buys you (fixes 4 of 9 Area-1 findings), vs. what a
map-less redesign buys you (fixes all 9 + eliminates the dragons surface)."
The counter is strong enough to deserve sizing, not strong enough to flip the
conclusion.

---

### Counter 2: "Dropping rich data is legitimate product simplification"

**Strongest counterposition.** Area 4's 12-dropped-fields tally reads as
indictment, but half of it is the product doing its job. `obsDt` dropped:
eBird.org already *is* a timeline; bird-watch explicitly describes itself as
a *spatial/ecoregion overview* (spec §Goal). Re-introducing a per-observation
timeline would make bird-watch a worse-layout clone of eBird's existing feed,
not a differentiated product. Observation `lat/lng` dropped: the product
collapses individual sightings to region-level badges *by design* — if the
value proposition is "9-ecoregion mental model of AZ birding," surfacing
per-point lat/lng undermines it by replacing the ecoregion story with a dot
map. `howMany`, `subId`, `locName` dropped: same logic — checklist-granularity
data is for a checklist product, not an ecoregion product. Area 3's
task-fit scores of 0 on T2 (where exactly) and T7 (what's new) are only a
failure if those tasks are in-scope; if the spec deliberately excluded them
(as the spec's wording suggests — it does not mention timelines or
per-location breakdowns anywhere in success criteria, `spec:345-352`), then the
tasks aren't failing, they're off the product's own ambition. The real question
Area 4 surfaces isn't "the UI is dropping data"; it's "the UI is dropping
data that the API pays to ship" — a backend/frontend contract mismatch, not
a user-experience failure.

**Evidence for the counter.**
- Spec §Success criteria (`docs/specs/2026-04-16-bird-watch-design.md:345-352`,
  cited in Area 3 Finding 1): all five bullets are rendering and mechanical.
  Zero mention of timelines, per-observation views, or per-hotspot views. The
  spec genuinely is "9-ecoregion spatial overview, not a feed."
- Spec §Goal (line 8, cited in Area 3 Finding 1): "wander Arizona
  *visually* and discover what birds have been seen *where*" — the two load-
  bearing words are "visually" and "where," not "when."
- Area 4 Finding 5 presents UI-shapes-feasible as a menu. Most entries there
  are feasible *with the current API* precisely because the product is
  deliberately narrow. eBird-with-a-different-skin would require photos,
  checklist metadata, and media — Area 4 Finding 6 shows those fields are
  *not* on the wire.
- The bird-watch site lives at bird-maps.com (user memory file
  `project_deployed_live.md`). The domain is "bird-*maps*." The brand
  commitment is spatial.

**Evidence against the counter.**
- Area 4 Surprise #1 ("The time axis is a ghost"): the server's `ORDER BY`
  key is `obs_dt DESC` (`observations.ts:147`) — the backend *does* treat
  time as load-bearing. If the product didn't need time, the ORDER BY would
  be arbitrary. The dropped field is not merely unused; it's contradicted.
- Area 3 Finding 7 (T7 scores 0, "staying current"): the spec defines
  `since=1d|7d|14d|30d` as a first-class filter. The filter exists precisely
  because *the spec does care about time*. Filtering by time but not showing
  time is incoherent.
- Area 3 Finding 5: the ecoregion framing excludes visiting birders and
  casual users (the two largest plausible audiences). "Product simplification"
  is defensible only if the retained user base is large enough. If the
  retained base is "local birders with prior ecoregion knowledge" (Area 3
  user-archetype assessment), the product is niche by its own success.
- Area 4 Finding 2 specifically calls out `Observation.locName` as dropped.
  If the product were intentionally polygon-coarse, `locName` wouldn't be
  plumbed to the frontend DTO at all. The data shape implies a
  finer-grained product that the UI layer doesn't render.

**Credibility: Moderate → Weak.**

The counter makes a real point on `lat/lng` and `subId` — those *could* be
deliberate simplifications consistent with an ecoregion-mental-model
product. But `obsDt` is genuinely indefensible: the spec defines a `since`
filter, the server orders by time, and the UI shows no time. That's a
contradiction, not a simplification. The counter also relies on the spec
being a fair representation of product intent — and Area 3 Finding 1 shows
the spec's success criteria themselves are rendering-centric, which means
the spec may not be a good defense witness.

**What Phase 3 should do.** Note as caveat. Synthesizers should separate the
dropped fields into two buckets: (a) *intentionally* simplified (`lat/lng`,
`subId`, `howMany`, `locName`) — honest-to-the-brand, may stay dropped; and
(b) *incoherently* dropped (`obsDt`, `latestObsDt`, row-level `isNotable`) —
these are contradictions with the declared filter surface. Not all 12 fields
are equal evidence of map failure.

---

### Counter 3: "The scaffolding's KEEP rating is overstated"

**Strongest counterposition.** Area 5 declares `SpeciesPanel`, `ApiClient`,
`url-state.ts` (minus regionId), and the data hooks as KEEP. But the KEEP
classification is tested only against the *existence* of a redesign, not its
shape. Three specific concerns:

(a) `SpeciesPanel.tsx` uses `position: fixed; right: 0; width: 320px`
(`styles.css:101-114`), and the accompanying comment at
`styles.css:94-100` explicitly says "intentionally detaches from the flex
layout so opening the panel does not reflow the map." The panel's layout
decision is *motivated by the map*. If a replacement UI is a flex column (list
+ detail) or a two-pane master-detail, the fixed-position right rail may fight
the new layout rather than fit it. The component itself is clean, but its
layout coupling to the map is hidden and real.

(b) `regionId` is used in 9 files and 32 total occurrences across
`frontend/` (grep: `regionId`). In KEEP/REFACTOR files that actually survive,
the count drops to ~12 occurrences (App.tsx ×2, url-state.ts ×4, tests ×6) —
Area 5's "trim and done" framing is close to accurate, but a naive reader of
Area 5 would miss that `App.tsx`'s `onSelectRegion` callback (`App.tsx:84`)
and the `expandedRegionId` prop-drill through `<Map>` (`App.tsx:80`) are
*interface contracts* that a replacement UI will need to replicate in whatever
its equivalent of "selected item" ends up being. The refactor cost is real.

(c) `ApiClient` is 51 LOC and pure HTTP, but KEEP assumes the API shape
doesn't change. The Area 4 UI-shapes-feasible matrix (Finding 5) notes a
temporal feed at thousands-of-rows-per-14d would want pagination
(`?limit`, `?cursor`), a per-region server-side filter (`?region=`, currently
frontend-only), and possibly `?sort` parameters. If the redesign needs any of
these — and several Area 4 feasibility entries imply it should — then
`ApiClient` needs extension. "KEEP" collapses "survives unchanged" into
"survives at all."

**Evidence for the counter.**
- `styles.css:94-100` — explicit documentation that the panel's position
  choice serves the map layout.
- `App.tsx:77-89` (the replacement boundary Area 5 itself identifies) — the
  `onSelectRegion`, `onSelectSpecies`, `expandedRegionId` triad is a map
  interface; a non-map UI needs an *analog*, not just a deletion.
- Area 4 Finding 5 — at least 3 entries (temporal feed, spatial plot,
  aggregate dashboard) would benefit from backend endpoints that don't
  currently exist. `ApiClient` would grow to cover them.
- Area 4 Finding 4 — "unpaginated; full array ships." If a redesign
  surfaces every observation (not aggregated by region), the current API
  may become a perf liability, not just a shape mismatch.

**Evidence against the counter.**
- Area 5's manifest is file-level, which is the right granularity for
  "what vanishes if the map dies." The KEEP classification is for "code
  that doesn't die," not "code that doesn't need rework ever."
- `SpeciesPanel` really is self-contained at the component level. Its
  `role="complementary"`, ESC handling, cache integration via
  `useSpeciesDetail`, and URL round-trip (`?species=`) are all non-map
  concepts. The `position: fixed` CSS is 20 lines; changing it to
  flex-flow or grid is trivial if the new layout wants that.
- The `regionId` occurrences in DISCARD files (Region.tsx, Map.tsx, badge
  specs) die *with* those files. Area 5's "trim and done" for url-state.ts
  specifically — 4 occurrences in one 70-LOC file — is accurate.
- `ApiClient` extension to add paging/sort is textbook TypeScript work.
  Area 5's KEEP does not claim the file is frozen; it claims it is
  a survivable foundation. That's a lower bar than the counter assumes.

**Credibility: Weak → Moderate on (a), Weak on (b), Moderate on (c).**

The `position: fixed` observation is real but minor — rewiring a 20-line
CSS block to fit a different parent layout is work, not a blocker. The
`regionId` ripple is largely in files that already die. The `ApiClient`
extension-cost point is the strongest of the three, and even it just means
"KEEP plus additions," not "KEEP was wrong." Area 5 is closer to right than
overstated.

**What Phase 3 should do.** Dismiss (b). Note (a) and (c) as caveats. The
synthesizers should flag that "KEEP 33% of production LOC" means "survives
the map's death," not "survives any product pivot intact." If the redesign
demands a new API shape or a non-sidebar layout, KEEP files need adjustments
that Area 5 correctly did not attempt to size.

---

### Counter 4 (bonus): "This is an execution story, not a design story"

**Strongest counterposition.** The failure pattern — 8 of 10 recent PRs
rendering fixes, 18 dragons comments, parent_id in the DB to serve SVG paint
order, polylabel algorithm inlined to avoid a dep — is consistent with a
specific execution choice that is reversible without changing the product
metaphor. Namely: *an experienced cartographic engineer, or a real map
library (Mapbox GL / Leaflet / MapLibre / deck.gl) from day one, would have
avoided ~80% of the documented problems.* None of them would have: hand-
authored SVG polygon topology, inlined a polylabel algorithm, reinvented
paint-order via parent_id, built `largestInscribedRect` from scratch, or
needed `vector-effect: non-scaling-stroke` workarounds. The map's
*conceptual* fitness (9 polygons showing AZ birds) may be entirely fine; what
failed is the *implementation* choice to build an SVG renderer from scratch
rather than stand on tooling that has solved these problems in production for
a decade. In this reading, "ditch the map" is the wrong conclusion; the right
conclusion is "ditch the from-scratch SVG approach."

**Evidence for the counter.**
- Area 2 Finding 2 — all 6 SVG-specific correctness mechanisms are
  "compensations for SVG paint-order absence of z-index" or for the SVG
  coordinate system. Every one of them is a solved problem in any production
  map library.
- Area 2 Finding 3 — two database migrations exist purely to support SVG
  rendering. A real map library would not have caused these.
- Area 2 Surprise #5 — polylabel is *inlined* (76 LOC of quad-tree geometry)
  to avoid a dependency. This is a cost imposed by a project-level policy,
  not a map-metaphor cost.
- Area 2 Finding 4 table — PR history is rendering-*fix* heavy, not
  product-*feature* heavy. Only 5 of 30 recent PRs are features (#96, #79,
  #78, #21, #66). This is a distributional tell: the team spent its cycles
  on infrastructure problems a library would have already solved.

**Evidence against the counter.**
- Area 1 Finding 3 (label collision in expanded view) and Finding 6
  (misleading spatial encoding) are *geometric and cognitive*, not
  implementation choices. Mapbox renders labels against vector tiles too;
  Mapbox expanding a small polygon to show a 4×4 badge grid of 14-char names
  at 9px font would produce the same label collisions because the geometry of
  "text length vs. inscribed rect" is independent of the renderer.
- Area 3 Task-Fit Matrix — no task scores 2. The failure at the user-task
  layer (T2 = 0, T5 = 0, T7 = 0) has nothing to do with SVG vs. Mapbox. A
  different renderer does not tell the user "here are the notable birds
  right now."
- Area 3 Finding 5 — the ecoregion taxonomy itself is opaque to visiting
  birders and casual users. No library fixes this; it is a content and
  taxonomy choice, not an implementation choice.
- Area 1 Finding 8 — overflow pip dominance. `MAX_COLLAPSED_BADGES = 12`
  isn't an SVG limit; it's a containment compromise driven by polygon area
  vs. legible badge size. The same tradeoff exists in any renderer.

**Credibility: Moderate.**

The execution critique is genuinely strong on the *engineering pain* side —
80% of Area 2's dragons would likely disappear under Mapbox or Leaflet. But
it does not touch the UX failures that motivated the ditch call, which are
about *what the map communicates* (Area 1 Findings 1, 3, 4, 6, 8) and *what
user tasks it serves* (Area 3, no task scoring 2). A more capable renderer
fixes the rendering churn and buys back Julian's weekends; it does not
surface species names in a polygon too narrow for them, give visiting
birders a place-name entry point, or make the time axis visible.

**What Phase 3 should do.** Incorporate in the narrative as a sharp
distinction: the rendering churn and the UX failures are *different failure
modes with different causes*. The former is an implementation-technology
choice (SVG from scratch) and is reversible without a redesign; the latter
is a metaphor-and-taxonomy choice (ecoregion polygons as primary interface)
and is not reversible within the metaphor. Synthesizers should avoid the
conflation that "rendering is hard" = "design is wrong." Area 2 and Area 1
document *different* broken things. This is the most important counter of
the four.

---

## Resolved Questions

- **Is "ditch the map" a phase-0 groupthink artifact?** Partly. Counter 1
  shows half of Area 1's failures are fixable in-metaphor; Counter 4 shows
  most of Area 2's churn is a renderer choice, not a metaphor choice. The
  strong convergence is real for the UX layer (Area 1 Findings 3, 4, 6, 8 +
  Area 3's 0-scoring tasks) and overstated for the engineering layer (Area 2
  would largely disappear on a different tech stack).
- **Is Area 4's "rich data dropped" a product critique or a contract
  critique?** Both. `obsDt` and `latestObsDt` are genuinely incoherent drops;
  `lat/lng`, `subId`, `howMany`, `locName` are defensible in a deliberately
  ecoregion-coarse product.
- **Is Area 5's KEEP classification overstated?** Mostly no. The
  `position: fixed` coupling on `SpeciesPanel` and the `ApiClient` extension
  cost are real but small-to-moderate. "Survives the map's death" is a
  narrower claim than "survives any pivot."

## Remaining Unknowns

- Whether Julian *visually prefers* the current map even given its
  communication failures. A personal-project user satisfaction signal
  dominates theoretical task-fit (see blind spot #1).
- Whether a focused 2-week in-metaphor rescue attempt has *already been
  costed* by Julian and rejected, or whether it simply hasn't been tried.
  The PR stream suggests incremental fixes; it doesn't tell us if a campaign
  has been attempted.
- Whether the "execution story" reading (Counter 4) is material: if Julian
  is unwilling to adopt a third-party map library (on code minimalism
  grounds — CLAUDE.md "no polylabel npm import" suggests strong NIH
  priors), then Counter 4's "use Mapbox instead" is unavailable regardless
  of its technical merit.

---

## What the Funnel Might Still Be Missing

Three blind spots that no Phase 1 investigator could have caught, because
they require context outside the codebase:

**1. This is a personal project; user satisfaction > theoretical task-fit.**
Area 3 grades 7 user tasks against an inferred audience (visiting birders,
casual users, local birders). But bird-watch is Julian's project — it lives
at bird-maps.com, a personal domain, deployed with no marketing
(`MEMORY.md` → `project_deployed_live.md`). The primary "user" might be
Julian himself. If the map is visually satisfying to him, the task-fit
0-scores don't invalidate the product; they just mean the product has
a different objective function than "serve visiting birders." A "ditch it"
recommendation that optimizes for archetype user-tasks may be optimizing
for the wrong utility. This alone should make Phase 3 synthesizers soften
"ditch" to "here's what you'd gain by ditching; here's what makes ditching
reasonable if you want those gains."

**2. The "ditch it" framing is user-originated, which may be a venting
moment rather than a product decision.** Phase 0 packet line 11 notes
"The user has decided to ditch the map" — but this follows 8 consecutive
rendering-bug PRs. That's classic engineer-fatigue signal: after a dragging
debugging campaign, any engineer says "this whole approach is wrong." By
Phase 1's synthesis, the fatigue has been reified into "the design is
broken," with five investigators stacking evidence for that conclusion.
The correct action may not be to execute the dissatisfaction ("redesign
away from the map") but to engineer around the pain ("adopt a map
library"). Counter 4 above is the technical version of this blind spot;
this is the emotional version.

**3. The ecoregion taxonomy might be the actual product, and the map might
just be its most obvious UI.** The spec commits to "9 ecoregions" as the
core mental model, not "polygons as the rendering." If the ecoregion
concept is the value proposition (and it is arguably the only thing on
bird-maps.com that differentiates from eBird.org), then any redesign that
drops ecoregions — which Area 3's archetypical user-task optimization
would suggest (visiting birders want cities/places, not ecoregions) —
destroys the product's reason to exist. A list-of-observations UI with
county filtering isn't bird-maps; it's a worse version of what eBird
already has. Phase 3 synthesizers should distinguish *three* things that
can each be kept or discarded independently: (a) the ecoregion taxonomy,
(b) the polygon-map rendering of that taxonomy, (c) the SVG-from-scratch
implementation of that polygon map. Phase 1's convergence "ditch the map"
does not distinguish these three, and collapsing them all into one
decision is how products lose their identity in a refactor.

---

## Revised Understanding

The Phase 1 convergence on "ditch the map" holds at the UX layer but is
partially conflated with a separable engineering layer. Of four red-team
counters:

- Counter 1 (underexecuted, not inherent): **Moderate** — half the Area 1
  failures are fixable in-metaphor, half are not.
- Counter 2 (product simplification, not data loss): **Moderate→Weak** — a
  real point on `lat/lng` and `subId`, indefensible on `obsDt`.
- Counter 3 (KEEP is overstated): **Weak→Moderate** — `ApiClient` extension
  cost is real, the rest is small.
- Counter 4 (execution, not design): **Moderate** — would vanish Area 2's
  engineering pain, does not touch Area 1's or Area 3's UX/task failures.

The single most important correction to the phase-1 narrative: **Area 1/3's
"UX is broken" and Area 2's "engineering is painful" are two different
failures with two different fixes**, and Phase 3 should resist collapsing
them. A Mapbox swap fixes the second without fixing the first; a redesign
fixes the first and may render the second moot. The user's "ditch the map"
call could reasonably resolve to: (a) keep the map, adopt a library — fixes
engineering only; (b) keep the ecoregions, drop the polygon UI — fixes UX
only, may destroy product identity; or (c) drop both ecoregions and
polygons — maximizes task-fit, at the cost of becoming a generic
observation UI.

Phase 3's job is to hold all three paths in view, not pick one.
