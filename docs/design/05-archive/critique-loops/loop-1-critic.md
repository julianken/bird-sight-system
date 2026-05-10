# Loop 1 Critic: Strategic Kinks

## Summary

The v3 mocks are visually coherent but carry a cluster of **silent decisions** the
mocks took without flagging — undefined empty/edge states, narrative-versus-surface
contradictions, and implementation traps that would force rework once a real
component dev started typing. Most kinks fall into three families: (1) the **lede**
makes claims the mocks never reconcile across views, filter states, or empty data;
(2) the **subtractive accent** rule conflicts with itself in several places where
the mocks already paint accent in non-decision positions; (3) the **photo
masthead** and **bottom-sheet** are rendered as if implementation is trivial, but
each smuggles in unscoped engineering work (LCP, focus-trap, snap mechanics, map
interaction underneath). The decisions table is internally consistent on what it
explicitly names; the kinks live where two settled decisions intersect at an
unmocked seam.

## Kinks identified

### Kink 1: The lede has no defined behavior under filter state, zero-result state, or stale-data state
- **Where it lives:** `sky-atlas-v3.html:965` (map lede "274 species seen across Arizona in the last 14 days.") vs `:1222` (feed lede "126 notable sightings across Arizona in the last 14 days."); decisions table rows for "Newspaper lede" + "Filter-active indicator" + "Loading/empty/error".
- **The kink:** The lede is a hard editorial claim that's a function of `(view, since, notable, familyCode, speciesCode, data freshness)`. The mocks show two hand-tuned strings for two filter states. There's no defined template for: filter narrowed to one family ("`X` species of woodpeckers..."?), zero results ("0 species" reads brutal — and contradicts a "magazine-grade" voice), data older than the implied freshness window (lede says "in the last 14 days" but `Updated 11 min ago` quietly lies if the ingestor lagged), or species-search active. Position B (opinionated utility) makes every lede a *truth claim* the system must defend at runtime — Agent 5's Counter 4(b) point that wasn't absorbed.
- **Why it matters:** Without a templating contract for the lede, implementation will either (a) hard-code two strings and quietly degrade for other filter combinations, or (b) discover at PR-review time that 12 lede variants need writing + reviewing. It also collides with the `<StatusBlock>` primitive — the lede is *outside* the status block but is itself a status surface when data is stale or empty.
- **Severity:** High

### Kink 2: Subtractive accent rule is already violated by the v3 mocks themselves
- **Where it lives:** Decisions table "Accent discipline · Subtractive — orange ONLY at decision points: active tab indicator, filter badge, focus halo, active phenology bars, NOTABLE meta-label, primary CTA"; mock contradictions at `sky-atlas-v3.html:303–304` (`.filter-bullet` paints "notable sightings" inside the lede sentence in `var(--accent)` — that's a *narrative* surface, not a decision point), `:481–485` (`.v3-popover-cta` "Open species detail →" colored accent — but it's a link, not a primary CTA in the rule's sense), `:644–647` (mobile progress bar uses `--accent` — defensible as "active progress" but not in the enumerated list), and the dark-mode "NOTABLE" label uses `--notable: #f5853b` which is the same hue family as `--accent` on light, blurring the rule's "notable is not accent" claim.
- **The kink:** The rule enumerates 6 sites; the mocks paint accent at ~9. Either the rule is wrong (and needs rewriting to match what the mocks actually show — "subtractive within editorial: accent marks reader attention, not just affordance") or the mocks are wrong (and several sites need to lose the accent). The decisions table treats this as settled but the mocks already drift from it.
- **Why it matters:** This is the load-bearing visual identity of Sky Atlas. If a component dev codes from the rule, they'll strip accent from `.filter-bullet` and the lede goes flat. If they code from the mocks, they'll paint accent everywhere "important" and the rule is decorative. Spec must pick.
- **Severity:** High

### Kink 3: Bottom-sheet on mobile is mocked at the half-snap with no defined snap-point semantics, focus management, or map-interaction contract
- **Where it lives:** `sky-atlas-v3.html:1377–1389` (bottom sheet at fixed `height: 60%`); decisions row "Modal on desktop + bottom-sheet on mobile (Apple Maps idiom; reuses `<dialog>` from `AttributionModal.tsx:182–261`)".
- **The kink:** Three problems compound. (a) The decisions table says reuse `<dialog>` — but `<dialog>` is modal by definition (focus-trapped, inert background); the mock's tagline says "Map remains live + pannable underneath," which is the *opposite* of `<dialog>` semantics. You cannot have both. (b) The mock shows three snap points (peek/half/full) but defines none — peek height? full = 100vh or 100% minus header? what triggers each? (c) When sheet is at peek, what's focused — sheet contents or the map? Tab order across a partially-occluding sheet is not a documented pattern in this codebase. The Apple Maps idiom uses `UISheetPresentationController` which is a native API with no web equivalent; the web port needs explicit decisions on each of these.
- **Why it matters:** Implementation will either ship a `<dialog>` (and break the "live map underneath" claim), or ship a non-`<dialog>` sheet (and rebuild focus trap + scrim + ESC handler from scratch — at which point the "reuses AttributionModal" cost claim is fiction). Either path forces a rework after dev starts.
- **Severity:** High

### Kink 4: Filter-chip strip on mobile has no defined empty/overflow/zero-active states
- **Where it lives:** `sky-atlas-v3.html:679–706` (filter strip CSS), `:1323–1327` (rendered with 3 chips: Notable, 14 days, + Filter); decisions row "Filter-active indicator: Badge + sentence".
- **The kink:** The strip is shown with two active filters + an "+ Filter" affordance. Undefined: (a) zero active filters (does the strip disappear, leaving only "+ Filter"? does the entire strip + sentence collapse? does the lede then lose its `--filter-bullet` accent?); (b) many filters active (>5) — the strip is `overflow-x: auto` but the badge says "2" — relationship between badge count and strip-visible count is not defined; (c) mobile filter strip exists but desktop filter chip strip does *not* exist in the mocks (desktop only has the Filters button + lede sentence) — that's an inconsistent affordance hierarchy across viewports for the same feature; (d) chip removal mechanism — the chips have no × affordance and no documented tap behavior.
- **Why it matters:** The filter sentence + badge pair is a settled decision; the chip strip is a *third* indicator that arrived in mocks without being in the decisions table. Either it's load-bearing (and needs spec) or it's noise (and should be removed). Currently it's both — present in mock, absent from decisions.
- **Severity:** Medium

### Kink 5: Photo-as-anchor + LCP — the analysis report's Finding 5.3 is not addressed
- **Where it lives:** `sky-atlas-v3.html:496–512` (`.v3-detail-photo` 320px height masthead); decisions row "Photo treatment: `<Photo>` primitive with built-in `loading=\"lazy\"` / `srcset` / attribution overlay; full-bleed anchor on detail surface"; analysis Finding 5.3 ("iNat photo no `loading=\"lazy\"`" today on detail surface).
- **The kink:** A full-bleed 320px-tall photo as the *first* element of the detail surface is, by definition, the LCP element. `loading="lazy"` on the LCP image is an anti-pattern (browsers ignore it for above-the-fold, but more importantly it delays the `<img>` from being prioritized — Core Web Vitals docs explicitly warn against this). The decisions table says the `<Photo>` primitive ships with built-in `loading="lazy"`. Two settled decisions therefore contradict: photo-as-anchor (above the fold) vs lazy-by-default primitive. Also unaddressed: detail surface opens *over* a map (modal) — does the photo fetch happen during modal-open animation? Network round-trip during a 200ms transition will pop-in.
- **Why it matters:** This is exactly the "looks fine in a demo, breaks at production dimensions" failure mode the prototype gate exists to catch. The `<Photo>` primitive needs a `priority` / `fetchpriority="high"` mode for the masthead use, and the decisions table should say so before implementation hard-codes the wrong default.
- **Severity:** Medium

### Kink 6: The wordmark "Bird Maps · Arizona" makes a regional commitment the data model doesn't enforce
- **Where it lives:** `sky-atlas-v3.html:946–950` (header wordmark), `:1316–1318` (mobile); decisions row "Brand mark: Dropped — wordmark only ('Bird Maps · Arizona')"; lede "274 species seen across Arizona...".
- **The kink:** "Bird Maps · Arizona" is mocked as static brand chrome, but the ingestor calls `/data/obs/US-AZ/recent` (CLAUDE.md) — Arizona is a *configuration*, not a brand. Open Question Q2 (analysis report) is exactly: "Is 'Arizona' appropriately broad, or does the data cover only a sub-region?" If the answer is "AZ today, expand later," the wordmark hard-codes the region into the identity. If the answer is "Arizona is the brand," that's a strategic product commitment that should be explicit, not implied by mock chrome. Also: the lede repeats "Arizona" — region claim is doubled, which doubles the maintenance burden if the scope ever changes.
- **Why it matters:** Removing region from wordmark later is cheap; locking it in now and discovering at expansion-time that the brand can't follow the data is expensive. This is a 30-second decision that prevents a multi-PR rename later.
- **Severity:** Medium

### Kink 7: "Updated 11 min ago · Source: eBird" is shown as static chrome but is a runtime claim with no defined fallback
- **Where it lives:** `sky-atlas-v3.html:964` (`.v3-context-meta`), repeated on every desktop surface.
- **The kink:** This is the most prominent truth-maintenance surface in the redesign — the freshness label sits next to the lede and supports the whole "real time from eBird" voice claim (Position B). The mocks hard-code "11 min ago." Undefined: (a) what shows when the ingestor last ran >1h ago (still says "1h ago" or escalates to "Stale — last updated 1h ago"?); (b) what shows when the read API has cached data older than the ingestor's last run (timestamp source — ingestor cron, observation `inserted_at`, or read-API `Cache-Control: max-age`?); (c) what shows during the loading state (the loading mock at `:1402–1463` doesn't show the meta line at all — does it disappear, skeleton, or hold the previous value?); (d) error state — when eBird is down and ingestor is failing, "Source: eBird" is the wrong claim. Plan 1's tables don't expose a freshness column on the read API today, so this surface is asking for new infra.
- **Why it matters:** Position B's whole argument is "opinionated utility = honest claims." The freshness label is the *single most consequential* honest claim on the page. Shipping it without a defined stale/error/loading contract means it will lie at exactly the moment it most matters.
- **Severity:** Medium

## Issues you considered but decided NOT to flag (with reason)

- **Mobile bottom-tab "Credits" tab is questionable IA.** Tabs are Feed/Species/Map/Credits — Credits is a low-frequency surface getting equal weight to the three primary views. Real but minor; tab-bar IA is below the threshold of "force a rework." Spec author can fix in 5 min.
- **Phenology bars use `--accent` for active months — could be density-encoded instead.** Theoretically a missed opportunity for the density triad to apply across the whole system. But the decisions table explicitly gives phenology to accent ("active phenology bars" is in the enumerated subtractive list), so this is settled, not a kink.
- **Family legend uses 4 shapes (circle/square/pentagon/diamond) but 7 families exist.** Decision row says "shape-paired in legend" — only 4 shape primitives shown. The 5th–7th shapes aren't in the mock but are in the decisions table by implication. Borderline; flagged in decisions deferred ("photo coverage / family palette") so partially absorbed.
- **The `feed-d-light` mock URL is `?view=feed&notable=true` but `notable` isn't in the documented `DEFAULTS` URL state.** Real (URL-state-vs-mock drift) but minor — one-line addition to `url-state.ts`. Plan-2-shaped fix, not a strategic kink.
