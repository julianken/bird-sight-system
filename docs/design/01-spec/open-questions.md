# Open questions — pre-ship gates

Eight gates (G1–G8) that don't block design implementation but should be resolved before final ship. Each has cost + resolution path. Status updated as gates close.

## Status table

| # | Gate | Status | Cost | Gates which phase |
|---|---|---|---|---|
| G1 | Audience profile (PostHog) | **Closed 2026-05-10: split signature — Position B** | 15 min | Phase 6 (voice + metadata) |
| G2 | Geographic precision | **Closed 2026-05-10: Arizona confirmed statewide** | 10 min | Phase 6 (lede region claim) |
| G3 | Bundle size baseline | Pending | 5 min | Phase 1 (before token foundation lands) |
| G4 | Photo coverage audit | **Closed 2026-05-09 — 91.1%** | done | Phase 2 (informs `<Photo>` no-photo state design) |
| G5 | MapLibre easeTo reduced-motion | Closes in Phase 0 | done with Phase 0 | (resolved by Phase 0 itself) |
| G6 | iOS safe-area | Pending | 30 min | Phase 4 (mobile bottom-sheet ship) |
| G7 | Family-color × basemap contrast | Pending | 30 min | Phase 1 (family-palette commit) |
| G8 | Dark basemap | Deferred to v1.1 | 1 hr | (gates v1.1 dark-mode promise; v1 ships light-only if G8 fails) |

## Detailed status

### G1 — Audience profile (PostHog)

**Closed 2026-05-10: split signature — Position B.**

Metrics read (7 total): bounce rate indeterminate (insufficient sample), mobile/desktop split balanced, return rate ~20% (below engaged threshold), session duration ~2 min (below engaged threshold), filter usage ~18% (below engaged threshold), detail-view depth unmeasured, repeat detail opens ~1 (below engaged threshold). Result: 0 engaged / 4 casual / 3 indeterminate. Split → Position B proceeds as written.

**Voice scope for Task 8:** Full Position B. Only `App.tsx:147` (raw error.message) requires a voice rewrite — the 14 other visible strings already match Position B register per the copy register inventory.

Brief: [`../03-research/pre-ship-gates/G1-audience.md`](../03-research/pre-ship-gates/G1-audience.md).

### G2 — Geographic precision

**Closed 2026-05-10: Arizona confirmed statewide.**

The ingestor uses `/data/obs/US-AZ/recent`, which is the eBird state-level endpoint covering all 15 Arizona counties. `REGION_LABEL = 'Arizona'` is accurate. No change to `frontend/src/config/region.ts` required.

### G3 — Bundle size baseline

**What's needed.** Establish the current bundle size baseline before any redesign component lands. One-time measurement.

**Resolution.** Run before Phase 1:

```bash
npm run build --workspace @bird-watch/frontend && du -sh frontend/dist
```

Record the result in this file as a footnote with the date. Future phase PRs compare against the baseline; CI alert if regression > 10%.

### G4 — Photo coverage audit ✓ CLOSED 2026-05-09

**Result: 91.1% coverage (328 of 360 species in 14-day window).**

Implications already absorbed into spec:

- `<Photo>` `family` prop accepts `FamilyCode | null` (2 species without family code observed)
- `<FamilySilhouette>` no-photo state is on the hot path (~9% of detail opens), not edge case
- Phase 2 acceptance criteria require silhouette quality at hero scale across all 7 family channels + null-family neutral state

Full audit: [`../03-research/pre-ship-gates/G4-photo-coverage.md`](../03-research/pre-ship-gates/G4-photo-coverage.md).

### G5 — MapLibre `easeTo` reduced-motion

**Status.** Suspected motion-leak at `frontend/src/components/map/MapCanvas.tsx:729` per analysis Theme 5 finding 5.6. The existing call passes no `duration` and does not check `prefers-reduced-motion`.

**Resolution.** Phase 0 Task 4 adds the guard. After Phase 0 ships, this gate is closed.

### G6 — iOS safe-area

**What's needed.** The mobile bottom-sheet (Phase 4) and bottom-tab bar (Phase 1+) need `padding-bottom: env(safe-area-inset-bottom)` on devices with a home indicator (iPhone X+). The codebase has zero `env()` calls and no `viewport-fit=cover` in `frontend/index.html`.

**Resolution.** Add `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">` to `index.html`. Add `padding-bottom: env(safe-area-inset-bottom, 0px)` to the bottom-bar and bottom-sheet containers. Test on a physical iPhone X+ or BrowserStack iOS simulator.

Gates Phase 4 mobile sheet ship.

### G7 — Family-color × basemap contrast

**What's needed.** The 7 earth-tone family colors in `tokens.ts:124–158` were chosen visually, never arithmetically tested against OpenFreeMap positron tile mid-tones. WCAG 1.4.11 (3:1 for non-text UI components) applies to silhouettes on map tiles.

**Resolution.** Sample tile colors at worst-case zoom; compute contrast ratios against silhouette fills. If any family fails 3:1 against the basemap, recommission that family's color.

Gates Phase 1's family-palette commit. If any family fails 3:1, the affected tokens are adjusted in `frontend/src/config/family-palette.ts` before Phase 2 consumes them.

### G8 — Dark basemap

**What's needed.** Dark mode requires a dark basemap. OpenFreeMap's dark style is community-driven; coverage and update cadence at production scale is unverified.

**Resolution.** Build a dark-basemap prototype at the prototype-gate fidelity (≥344 rows, mobile + desktop, all interactive surfaces exercised). Verify the family palette clears 3:1 against dark tiles for all 7 families. If any fails, ship light-only first and defer dark mode to v1.1.

**Recommendation.** Do not promise dark mode in marketing/social meta tags until G8 passes. Phase 1 ships the `[data-theme]` mechanism; whether the dark-mode toggle is exposed to users in v1 depends on G8.

## Update protocol

When a gate closes:

1. Update the status table at the top of this file.
2. Add a brief status update under the gate's detailed section with the date.
3. If the closing affects spec content, update the relevant `01-spec/` file.
4. Move the resolution detail to `../03-research/pre-ship-gates/<gate>.md` (long form) and link from this summary.

## Cross-references

- Phase plans that close specific gates: [`../02-phases/`](../02-phases/)
- Long-form gate audits: [`../03-research/pre-ship-gates/`](../03-research/pre-ship-gates/)
- Original analysis report (where these gates first surfaced): [`../03-research/analysis-funnel-summary.md`](../03-research/analysis-funnel-summary.md)
