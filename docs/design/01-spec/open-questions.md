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
| G7 | Family-color × basemap contrast | **Closed 2026-05-16: palette audit + 19-color rebalance (PR #577)** | done | Phase 1 (family-palette commit) |
| G8 | Dark basemap | **Closed 2026-05-16: BASEMAP_DARK flipped to real dark tile (PR #582)** | done | Phase 4 (this PR) |

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

**Status: CLOSED 2026-05-16 (PR #577, Phase 1 of adaptive-grid contrast epic #575).**

Palette audit ran via `scripts/check-family-palette-contrast.ts` against the light basemap (`#f4f1ea`). 19 failing colors (17 Phylopic-curated backfill + 2 original seeds) were re-picked to score ≥ 3:1 against both basemaps at full opacity. CI workflow `.github/workflows/family-palette-contrast.yml` gates regressions going forward. SQL migration under `migrations/` records the before/after hex values.

### G8 — Dark basemap

**Status: CLOSED 2026-05-16 (PR #582, Phase 4 of adaptive-grid contrast epic #575).**

`BASEMAP_DARK` alias flipped from `= BASEMAP_LIGHT` to `= 'https://tiles.openfreemap.org/styles/dark'` in `frontend/src/components/map/basemap-style.ts`. The existing `MutationObserver` in `MapCanvas.tsx` drives the live basemap swap on theme toggle — no additional wiring needed. Verified at 1440×900 via a Playwright e2e pixel-sample spec (`frontend/e2e/basemap-dark-flip.spec.ts`) asserting AC1 (luminance delta >0.3), AC2 (light pixel within ±20 of #f4f1ea), AC3 (dark pixel <60 per channel). Actual sampled pixels: light=[230,233,229] (lum≈0.808), dark=[12,12,12] (lum≈0.004), delta≈0.804. All three assertions pass. `preserveDrawingBuffer: true` is enabled in e2e mode via `VITE_E2E_PRESERVE_BUFFER` (PR #582 Fix 3b).

## W5 spec captures (2026-05-11)

Items surfaced by the 2026-05-11 brainstorm-vs-production fidelity audit (`coverage-matrix-v4.md`) and formally resolved here.

### Body radial-gradient — DEFERRED-INTENTIONAL

The v4 brainstorm mock specifies a two-layer radial-gradient on the map-area background (`sky-atlas-v4.html:253-264`):

```css
/* light */
background:
  radial-gradient(ellipse at 25% 30%, rgba(245,133,59,0.04), transparent 60%),
  radial-gradient(ellipse at 75% 70%, rgba(74,123,168,0.05), transparent 60%),
  #efe9dc;
/* dark */
background:
  radial-gradient(ellipse at 25% 30%, rgba(109,184,212,0.05), transparent 60%),
  radial-gradient(ellipse at 75% 70%, rgba(245,133,59,0.04), transparent 60%),
  #182238;
```

Production ships a flat `--color-bg-page` (`#f4f1ea` light / `#0d1424` dark — `tokens.css`). The gradient was silently dropped without documentation.

**Decision (2026-05-11):** `DEFERRED-INTENTIONAL` — not adopted in v1. Rationale: (1) The flat value is simpler to reason about for dark-mode contrast, especially under the family-color overlay on the map canvas. (2) The gradient is a 4% opacity "atmospheric warmth" effect — it is imperceptible in most system-font rendering environments and adds CPU/GPU composite cost on low-end mobile. (3) Contrast arithmetic is harder against a non-uniform background; WCAG compliance is provable on flat but only probabilistic on a gradient. (4) A future v1.1 "atmosphere mode" can adopt the gradient as an opt-in visual layer rather than baking it into the base token.

**If adopted in v1.1:** introduce `--color-bg-atmosphere-light` and `--color-bg-atmosphere-dark` as optional overlay tokens; do not fold them into `--color-bg-page`. The gradient must be verified against all 7 family-color silhouettes (G7) at their worst-case opacity. File a new issue to track.

**Coverage-matrix row:** row 90 (`body background radial-gradient`) — update disposition from `DROPPED — UNSTATED` to `DEFERRED-INTENTIONAL`, cite `open-questions.md:W5-spec-captures`.

### `--accent-secondary` / `--accent-cool` compression — DROPPED — DOCUMENTED

The system poster (`sky-atlas-system.html:17-18`) defined three accent hues: `--accent` (orange/cyan), `--accent-secondary: #1d3b5b` (deep sky), and `--accent-cool: #4a7ba8` (daylight blue). v4 collapsed to one accent token (`--color-decision-point`) under the subtractive discipline (`voice-and-content.md:104-108`). The compression was previously DROPPED — UNSTATED because the rationale existed in `voice-and-content.md` but was not cross-linked to the token itself.

**Decision (2026-05-11):** `DROPPED — DOCUMENTED`. The subtractive rationale in `voice-and-content.md:104-108` is the authoritative explanation. The system-poster three-accent proposal was a brainstorm option, not a committed contract. The single `--color-decision-point` token is correct. No follow-up needed.

**Coverage-matrix row:** row 91 — update from `DROPPED — UNSTATED` to `DROPPED — DOCUMENTED`.

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
