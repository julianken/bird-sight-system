# Design agents — synthesized

Five specialist agents dispatched in parallel during the brainstorm to generate independent design ideas. Each had a distinct lens; each wrote 5–7 ideas plus an optional bold direction.

Full agent outputs: [`../05-archive/design-agents/`](../05-archive/design-agents/).

## The five lenses

| # | Agent | Lens |
|---|---|---|
| 1 | UX/Visual designer | What user moments are most underexplored? |
| 2 | Design system architect | The codebase isn't missing tokens — it's missing primitives between tokens and surfaces |
| 3 | Accessibility-shaped designer | Let the a11y substrate set the visual grammar |
| 4 | iOS / Apple-style designer | Apple-grade restraint is a posture problem, not a component problem |
| 5 | Dissent / counter-proposal | Sky Atlas is the most ambitious direction — also the highest blast radius |

## Convergent moves (where 2+ agents independently agreed)

These are the strongest signal — multiple specialists arrived at the same conclusion through different lenses. All absorbed into the spec.

### `<StatusBlock>` primitive — Agents 2 + 3

One component (`state="loading|empty|error"`) collapses 9 CSS classes / 14 copy-pairs into a single API. Becomes the canvas for the 730px map skeleton; fixes the inverted error severity in `App.tsx:147` for free; becomes where motion lives so `prefers-reduced-motion` is enforceable in one place.

Spec: [`../01-spec/components.md#statusblock`](../01-spec/components.md#statusblock). Phase: [`Phase 2`](../02-phases/phase-2-primitives.md).

### Cluster-bubble palette as measured-contrast triad — Agents 2 + 3 + 4

Replace eyeballed `#51bbd6 / #f1f075 / #f28cb1` with a named atmospheric triad: Sky 8.2:1 / Sand 10.4:1 / Ember 5.1:1 against text-strong. Names + arithmetic ratios baked in. Closes the axe-canvas-excluded contrast gap by process. Triad doubles as Sky Atlas's atmospheric metaphor.

### Cluster bubbles as Apple-Maps pills, not solid circles — Agents 4 + 3

White / dark fill + 2px density-coded stroke + count text on the surface (not on the colored fill). Reads as cartography, not game UI. Family color goes on stroke; text always sits on `--color-bg-surface` so contrast becomes deterministic.

### System font as the brand, no webfont — Agents 4 + 2

SF Pro / Segoe UI Variable / Roboto each user reads in their native typeface. Collapses 35+ font-size literals to a 6-step Apple HIG-derived ramp (11/13/15/17/22/34). Zero perf cost, zero CLS risk. Webfont swap is a one-token operation if ever needed.

### Subtractive accent discipline — Agents 4 + 1 + 3

Sunrise orange (light) / aurora cyan (dark) appears ONLY at decision points: active tab indicator, filter badge, focus halo, active phenology bars, NOTABLE meta-label, primary CTA, filter-sentence emphasis, active mobile bottom-tab. Spec enumerates 8 sites; everywhere else stays muted text.

### Family palette as role-channel, not brand color — Agent 2

Stop treating DB family colors as if they compete with chrome accent. Promote to a named channel: `--channel-family-fill` + auto-paired `--channel-family-on` for AA contrast. Chrome accent answers a different question. Dissolves the "two color systems" problem — one system, two roles.

The mechanism settled in critique loop 2 K1: JS-computed lookup table (`getFamilyChannel(code)` returning `{fill, on}`) — the only path that satisfies AA pairing + hero-fallback availability + no DB churn.

## Bold individual moves

### `<FilterSentence>` as a sentence, not just a badge — Agent 1

Render an active-filter sentence in muted 13px below the lede: "Showing notable sightings from the last 14 days." Template-driven, zero new state. Same string lives in `aria-live` (per Agent 3's "two voices, one composition"). Both badge and sentence update in sync.

### Map popover as the discovery moment — Agent 1

Sharpen the cluster-tap popover with: silhouette SVG at 32px in accent color, "×N seen today" micro-stat, spring entry animation (200ms cubic-bezier 0.34,1.56,0.64,1) wrapped in `prefers-reduced-motion`. The popover is currently the highest-delight surface and underperforms.

### Newspaper lede — Agent 1

Replace the count-style subhead with a single newspaper-grade sentence at hero scale: "274 species seen across Arizona in the last 14 days." Position B voice made physical. ~20 lines of CSS. Gives first-time visitors orientation before they touch a filter.

### `[data-theme]` override + `prefers-color-scheme` fallback — Agent 2

Light/dark via `[data-theme]` on `<html>`, persisted in localStorage. `prefers-color-scheme: dark` only as initial default. Map basemap swap (positron → dark-matter) is user-visible and demands a manual signal.

### Three-mode theme: Day / Night / Stillness — Agent 3

Reduced-motion as a first-class branded mode (☀ / ☾ / ⏳ icons) instead of an OS-level afterthought. Brand has a contemplative-still register. Adds one axe row.

**Status: deferred to v1.1.** Phase 0's global `motion.css` covers OS-level reduced-motion; the explicit Stillness toggle waits.

### Cluster-manifest keyboard rail — Agent 3

Off-screen-but-tab-reachable list of named visible clusters ("Pinaleño Mountains, 247 birds"). Activation = flyTo + cluster-expand. Renders as a 36px collapsed left rail. Doubles as discovery — teaches users named Arizona birding geography.

**Status: deferred to v1.1.** Adds chrome surface area; current keyboard story is map-view skip-link only.

### Bottom-sheet detail with snap points — Agent 4

Apple Maps "Look Up" pattern: peek (~120px) / half (~50%) / full (~90%). Map underneath remains live in peek + half. Drag-down dismisses. ESC dismisses. Resolves the "no back button" failure as a side effect.

Spec: [`../01-spec/architecture.md`](../01-spec/architecture.md), [`../01-spec/accessibility.md`](../01-spec/accessibility.md). Phase: [`Phase 4`](../02-phases/phase-4-detail-surface.md).

### System skeletons + 2px progress line — Agent 4

Flat grey rectangles at incoming-content dimensions (no shimmer, no gradient sweep). 2px sunrise-orange progress bar at top of the chrome (Safari URL-bar style). Loading vs empty become visually distinct. `<progress>` native element.

### Inverse-luminance focus halo — Agent 3

2px ring + 2px outline-offset gap creating a halo around focused elements. Color computed via `color-mix` for 3:1 against the immediate surface. WCAG 2.4.11 Focus Appearance becomes mathematical. Focus becomes brand flourish, not OS default.

### Color-independent shape pairing — Agent 3

Family colors paired with shape modifiers (circle / square / pentagon / diamond). Every color paired with a non-color encoding. WCAG 1.4.1 holds without depending on luminance. Color-blind users (8% of male users) read state from greyscale.

## Counter-positions (Agent 5)

Each pushed back on an upstream assumption. The most consequential ones absorbed:

### Audience frame is unmeasured (Counter 1)

"Casual / visual exploration" was a chosen frame, not a finding. The analysis report itself flagged G1 (audience profile) as completely unsampled. **Decision**: Phase 0–5 are voice-orthogonal; G1 closes before Phase 6 (voice + metadata).

### Sky Atlas's photo-led identity rests on undocumented coverage (Counter 2)

Hero mastheads on every detail surface assume photo coverage that hadn't been audited. **Decision**: G4 audit ran 2026-05-09; result 91.1%. The no-photo silhouette state is on the hot path (~9% of detail opens), not edge case. Spec amended.

### Front door change was implicit (Counter 3)

The brainstorm mocks showed map as headline surface but the spec hadn't adjudicated. **Decision**: explicitly resolved S4 — map is home route. Phase 0 ships `DEFAULTS.view='map'`.

### Position A++ may be the right voice (Counter 4)

Position B's claim of "opinionated voice in-app" can be separated from the metadata fix. Filling 19 metadata gaps with neutral factual claims also closes the SEO gap, without rewriting 14 strings. **Decision**: Phase 6 conditional on G1 — if engaged-birder signature, Position A++ refinement; if casual, Position B.

### Dark mode may be structurally infeasible (Counter 5)

OpenFreeMap dark style is community-driven and unverified at production. Family palette is cream-tuned; against near-black tiles, several earth tones may fail 3:1. **Decision**: G8 prototype-gate; if it fails, ship light-only first. Spec preserves the `[data-theme]` mechanism either way.

### Counter directions worth holding (Counter 6 + 7)

- **Data Atlas direction** (Bloomberg-for-birds) — epistemic register Sky Atlas's aesthetic register doesn't address. Worth keeping in pocket if G1 returns engaged-birder.
- **Field Notebook direction** (humanist serif, ink + watercolor) — different register entirely. Cheaper to ship than Sky Atlas; treats user as expert.

Both deferred. Sky Atlas is what's chosen for v1.

## How agent contributions map to spec sections

| Spec section | Agents that contributed |
|---|---|
| [`tokens.md`](../01-spec/tokens.md) — three-tier contract, type ramp | 2, 4 |
| [`components.md`](../01-spec/components.md) — `<StatusBlock>`, `<Photo>` | 2, 3 |
| [`components.md`](../01-spec/components.md) — `<ClusterPill>` | 2, 3, 4 |
| [`components.md`](../01-spec/components.md) — `<FilterSentence>` | 1, 3 |
| [`accessibility.md`](../01-spec/accessibility.md) — focus halo, shape pairing | 3 |
| [`accessibility.md`](../01-spec/accessibility.md) — bottom-sheet ARIA | 4 |
| [`voice-and-content.md`](../01-spec/voice-and-content.md) — newspaper lede, filter sentence | 1, 3 |
| [`voice-and-content.md`](../01-spec/voice-and-content.md) — accent discipline | 1, 3, 4 |
| [`motion.md`](../01-spec/motion.md) — global rule, MapLibre guard | 3, 4 |
| [`open-questions.md`](../01-spec/open-questions.md) — G1, G4 | 5 |

## Cross-references

- Original outputs: [`../05-archive/design-agents/agent-{1..5}-*.md`](../05-archive/design-agents/)
- Critique loops that pressure-tested these ideas: [`critique-loops-summary.md`](./critique-loops-summary.md)
- Decisions absorbed: [`../00-overview/decisions.md`](../00-overview/decisions.md)
