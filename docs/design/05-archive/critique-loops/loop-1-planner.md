# Loop 1 Planner: Strategic Fixes

## Summary

Six of the seven kinks share a single root failure: the mocks made runtime claims (lede copy, freshness timestamp, filter chip state, accent placement) without specifying the contract that makes those claims true across all states. The fixes below add that contract text — either as an enumerated template set (Kinks 1, 7), a rule revision (Kink 2), an architecture clarification with a concrete element swap (Kink 3), a strip simplification (Kink 4), a primitive attribute addition (Kink 5), or a one-sentence copy choice (Kink 6). None require reopening a settled decision; two require a minor amendment to the decisions table wording.

---

## Fixes (one per kink)

### Fix for Kink 1: Lede has no defined behavior under filter / zero-result / stale-data states

**The fix:** Define a lede template contract in the spec (not in the mock HTML). Four canonical templates, evaluated in priority order at render time:

1. **Zero results:** "No sightings match your current filters." — no count, no region claim, no period claim. Plain sentence, same `.v3-lede` class, no filter bullet.
2. **Single species search active:** "{N} sightings of {common name} in Arizona in the last {period}." — `speciesCode` resolves to common name via existing `species` table.
3. **Family filter active:** "{N} species of {family name} seen across Arizona in the last {period}." — `familyCode` resolves to family common name.
4. **Default (no narrowing filter):** "{N} species seen across Arizona in the last {period}." — current mock string.

Stale data (ingestor lag > threshold from Kink 7 fix): lede drops the period clause — "274 species seen across Arizona." — and the `.v3-context-meta` escalates (see Kink 7). The filter sentence below the lede remains unchanged in all states; it carries the active-filter description so the lede need not repeat it.

**Why this works:** Gives implementation exactly four branches with defined outputs. Prevents the "12 lede variants discovered at PR review" failure. The lede remains a truth claim because it never asserts a time window it cannot verify.

**Cost:** Small — spec text, no new UI primitives. Copy must be reviewed for each template (1–2 rounds).

**Open question / follow-up:** The zero-results lede is intentionally flat prose. If the design voice requires an alternative empty state (illustration + CTA), that belongs in `<StatusBlock>`, not the lede. Confirm whether `<StatusBlock>` replaces or supplements the lede area at zero results.

---

### Fix for Kink 2: Subtractive accent rule already violated by the mocks

**The fix:** Revise the decisions-table accent rule to match what the mocks actually show — i.e., expand the enumerated list from 6 to 8 canonical sites and add one explicit exclusion. The revised rule reads:

> **Subtractive accent** — orange (light `#f5853b`) / cyan (dark `#6db8d4`) appears ONLY at:
> 1. Active tab indicator (`::after` underline on `.v3-nav-link.active`)
> 2. Filter badge (`.v3-filter-badge` background)
> 3. Focus halo (2px `outline` on focused interactive elements)
> 4. Active phenology bars (`.v3-phen-bar.active`)
> 5. NOTABLE meta-label on the top feed card (`.v3-feed-card-meta` color = `var(--notable)` — see note)
> 6. Primary CTA in detail body (if one is added; not currently mocked)
> 7. **Filter sentence emphasis** — `.filter-bullet` inside `.v3-filter-sentence` receives accent to mark the active filter term (narrative surface, but reader-action-confirming, not decorative)
> 8. **Active mobile tab** (`.v3-mobile-tab.active` color)
>
> **Explicit exclusion:** `.v3-popover-cta` ("Open species detail →") changes from `var(--accent)` to `var(--text-body)` with `text-decoration: underline`. It is a link affordance, not a primary CTA in the rule's sense. This is the one mock element that loses accent under the revised rule.
>
> **Notable vs accent note:** `--notable` (`#c43a1a` light / `#f5853b` dark) is a distinct token even when its dark-mode value is close to the light-mode `--accent` hue. Component code must reference `--notable`, never `--accent`, for NOTABLE labels. The tokens must not be aliased.

**Why this works:** Resolves the spec-vs-mock contradiction by canonicalizing what the mocks actually show, with one deliberate correction (popover CTA) and one explicit token-naming guard (notable vs accent). Component devs can implement from the rule alone.

**Cost:** Tiny — decisions table text edit + one CSS property change on `.v3-popover-cta`.

**Open question / follow-up:** Confirm the mobile progress bar (`.v3-mobile-progress`, `background: var(--accent)`, line 644) is intentionally included in the "active loading progress" category. If yes, add it as site 9. If not, change it to `var(--density-sky)` as a neutral loading indicator.

---

### Fix for Kink 3: Bottom-sheet has no snap semantics, focus contract, or map-interaction definition

**The fix:** Three concrete sub-fixes, each standalone:

**(a) Element choice — drop `<dialog>`, use a positioned `<div>` with `inert` management:**
Replace the "`reuses <dialog> from AttributionModal.tsx:182–261`" text in the decisions table with: "Mobile bottom-sheet is a `<div role='dialog' aria-modal='false'>` positioned `absolute` within `.v3-mobile-content`. It is NOT a `<dialog>` element. Focus is managed manually: when sheet opens at peek, focus stays on the map; when sheet is dragged to half or full, `inert` is set on the map container and focus moves to the sheet handle. ESC handler and scrim are implemented independently."

**(b) Snap point definitions:**
- **Peek:** `height: 96px` (handle 20px + photo thumb 56px + 20px stat line). Triggered: cluster tap.
- **Half:** `height: 60%` of `.v3-mobile-content`. Triggered: drag upward past peek + 40px, or single tap on handle at peek.
- **Full:** `height: calc(100% - 8px)`. Triggered: drag upward past half + 40px. Scroll within `.v3-sheet-body` is enabled only at full snap.

**(c) Map interaction contract:**
At peek and half: map remains interactive (pan, pinch, cluster tap). At full: map receives `pointer-events: none` via a class added to `.v3-map-area`. This is the only state change the map needs; no map API calls are required.

**Why this works:** Removes the `<dialog>` contradiction without reopening the "modal desktop + sheet mobile" decision. The sheet is still semantically a dialog (`role='dialog'`), but uses non-modal ARIA so the map is not inerted at peek/half. Each snap point is a concrete pixel value a dev can implement with a single `touchend` velocity check.

**Cost:** Medium — replaces one line in the decisions table but meaningfully changes the implementation contract. Dev cost is higher than the original "reuse `<dialog>`" fiction, but this is accurate cost, not added cost.

**Open question / follow-up:** Define the swipe-to-dismiss gesture: does dragging below peek dismiss (sheet unmounts) or snap back to peek? Recommend dismiss — avoids a persistently-peeking sheet after the user is done.

---

### Fix for Kink 4: Filter-chip strip on mobile has no defined empty / overflow / zero-active states

**The fix:** Demote the chip strip from a third indicator to a read-only mirror of the filter badge, with these rules:

- **Zero active filters:** `.v3-mobile-filter-strip` is hidden (`display: none`). The lede and filter sentence on desktop are the only active-filter surfaces at zero.
- **One or more active filters:** strip renders, showing one chip per active filter (not a count badge — the actual filter name). Maximum 3 chips visible before strip scrolls; no chip count cap.
- **Chip interaction:** chips are read-only indicators on mobile (no × affordance). Tap on any chip opens the full filter panel (same target as the "Filters [N]" button). This collapses the "chip removal" question: removal happens inside the panel, not in the strip.
- **Desktop:** strip does not exist on desktop. The filter sentence below the lede is the sole active-filter narrative on desktop. This resolves the cross-viewport inconsistency by making the strip a mobile-only affordance, not a shared component.

Add one row to the decisions table: "Mobile filter strip: read-only chip mirror; tap opens filter panel; hidden at zero filters; desktop has no strip."

**Why this works:** Eliminates the spec gap without adding a new interaction primitive. The strip becomes purely presentational — its state is derived from the same source as the badge, so they cannot desync.

**Cost:** Tiny — strip loses interactive × affordance (a simplification, not a feature cut). Filter panel remains the single mutation point.

**Open question / follow-up:** None. The filter panel's own design is not in scope for this critique loop.

---

### Fix for Kink 5: Photo-as-anchor conflicts with `loading="lazy"` on the LCP element

**The fix:** Add a `priority` boolean prop to the `<Photo>` primitive. When `priority={true}`, the rendered `<img>` gets `loading="eager" fetchpriority="high"` and is excluded from any lazy-intersection-observer logic. The detail surface masthead (`.v3-detail-photo` / `.v3-sheet-photo`) always passes `priority={true}`. All other `<Photo>` usages (feed thumbnails, silhouettes) default to `loading="lazy" fetchpriority="auto"`.

Update the decisions table row for "Photo treatment" to read: "`<Photo>` primitive with built-in `loading='lazy'` / `srcset` / attribution overlay; full-bleed anchor on detail surface passes `priority={true}` (`loading='eager' fetchpriority='high'`) to avoid LCP penalty."

For the pop-in-during-animation concern: the detail modal opens with a 200ms `opacity` transition (not `transform`). Add `will-change: opacity` to the modal container; do not animate `transform` on the photo element. The browser will begin fetching the photo on `pushState` (or modal trigger), before the animation starts, because `fetchpriority="high"` moves it into the high-priority fetch queue immediately on DOM insertion.

**Why this works:** Directly resolves the "lazy on LCP is an anti-pattern" finding without changing the primitive's default (lazy is still correct for feed thumbnails). The `priority` prop pattern is the same used by Next.js `<Image>` and is familiar to React devs.

**Cost:** Small — one prop, one branch in `<Photo>`, one decisions-table line update.

**Open question / follow-up:** Verify that the photo URL returned by the read API is a direct CDN URL (not a redirect chain), since `fetchpriority="high"` only helps if the browser can preconnect. If the URL goes through an iNat redirect, add a `<link rel="preconnect">` for the iNat CDN origin in `index.html`.

---

### Fix for Kink 6: "Bird Maps · Arizona" wordmark hard-codes a regional commitment

**The fix:** Separate the brand name from the region scope at the token / component level. The wordmark renders as two parts:

- `.v3-brand-name` — "Bird Maps" — static, never changes.
- `.v3-brand-region` — "· Arizona" (desktop) / "· AZ" (mobile, per existing mock at line 1317) — populated from a `REGION_LABEL` config constant, not hard-coded in JSX.

Add to the codebase: `frontend/src/config/region.ts` exports `export const REGION_LABEL = 'Arizona'` and `export const REGION_ABBR = 'AZ'`. The lede template (Kink 1 fix) also sources its region string from `REGION_LABEL`, so a future region change is a one-file edit.

No visual change to the current mocks. The strategic commitment "Arizona is the brand" is explicitly recorded in the decisions table as: "Region name in wordmark is driven by `REGION_LABEL` config; current value is 'Arizona'; changing scope is a config edit, not a rename." This makes the scope decision explicit without forcing a decision now.

**Why this works:** Zero visual cost. Removes the maintenance risk the critic identified while preserving the current mock exactly. The config file makes the implicit decision explicit for future maintainers.

**Cost:** Tiny — one new 3-line file, no mock changes.

**Open question / follow-up:** None. The strategic product question ("Arizona forever?") is now documented and deferred correctly — it no longer needs to be resolved before implementation.

---

### Fix for Kink 7: "Updated 11 min ago · Source: eBird" is a runtime truth claim with no fallback

**The fix:** Define the freshness label as a four-state component, not a static string. The states and their rendered output for `.v3-context-meta`:

| State | Condition | Rendered text |
|---|---|---|
| **Fresh** | `age < 30 min` | "Updated {N} min ago · Source: eBird" |
| **Recent** | `30 min ≤ age < 2h` | "Updated {N}h ago · Source: eBird" |
| **Stale** | `age ≥ 2h` | "Data from {absolute time} · Source: eBird" — no relative claim |
| **Error / unknown** | ingestor failing, age unavailable | "Source: eBird" — drops timestamp entirely, no lie |

The timestamp source is `observations.inserted_at` (the ingestor write time), surfaced via a new `meta.freshest_observation_at` field on the existing read API response. This is a small read-API addition (one SQL `MAX()` on `inserted_at`, no new table, no schema migration).

During loading: `.v3-context-meta` renders a skeleton rectangle (`var(--bg-skeleton)`, `width: 120px`, `height: 28px`) using the existing `.v3-skeleton-rect` class. It does not hold the previous value — the lede skeleton already covers the lede; the meta skeleton covers the meta. Both animate via the progress bar, not shimmer.

Add to the decisions table: "Freshness label: four-state (`fresh / recent / stale / error`); source field `meta.freshest_observation_at` on read API response; error state drops timestamp; loading state uses skeleton."

**Why this works:** The freshness label is now a component with a defined contract instead of a hard-coded string. The read API addition is a single `SELECT MAX(inserted_at)` — no new infrastructure. The error state degrades gracefully (shows attribution without a false time claim).

**Cost:** Small — one new read-API field, one new frontend component state machine, spec text.

**Open question / follow-up:** Confirm the stale threshold (2h). The ingestor is scheduled; if the cron interval is 1h, the "stale" threshold should be 1.5× the cron interval — so 90 min if cron is hourly. The threshold should be a config constant alongside `REGION_LABEL`.

---

## Cross-cutting recommendation

Kinks 1, 6, and 7 all expose the same root gap: **runtime claims (lede, region, freshness) are written as static mock strings, with no source-of-truth contract defined in the spec.** The one fix that addresses all three at once is adding a `frontend/src/config/` module (started by Kink 6's `region.ts`) that also exports `FRESHNESS_STALE_THRESHOLD_MS` and that the lede template function imports. This keeps all "system truth parameters" in one auditable location and prevents the same pattern from recurring for future runtime claims (e.g., a hypothetical "Notable species this week" count).
