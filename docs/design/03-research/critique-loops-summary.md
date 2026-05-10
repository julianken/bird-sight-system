# Critique loops — synthesized

After Sky Atlas direction was chosen and v3 mocks were assembled, three sequential critic-planner loops ran to identify and resolve remaining kinks. Each loop = one critic pass + one planner pass. Total: 6 agent runs, 19 kinks identified, 16 resolved as spec contracts (no mock change), 3 produced visible deltas.

Full artifacts: [`../05-archive/critique-loops/`](../05-archive/critique-loops/) — 6 files (loops 1, 2, 3 × critic + planner).

## Loop structure

| Loop | Critic lens | Planner lens | Target |
|---|---|---|---|
| 1 | Strategic kinks (dissent generator) | UX/UI designer | High-level inconsistencies, undefined states, narrative drift |
| 2 | System cohesion (component architect) | Design-system architect | Primitive boundaries, mechanism ambiguity, namespace collision |
| 3 | A11y + final polish (accessibility expert) | Code architect | ARIA contracts, focus order, reduced-motion, edge-case quality |

## 19 kinks resolved

### Loop 1 — Strategic kinks (7 kinks)

1. **Lede has no defined behavior** under filter / zero-results / stale-data states → 4-template state machine in [`../01-spec/voice-and-content.md`](../01-spec/voice-and-content.md)
2. **Subtractive accent rule violated by mocks** (popover CTA, lede emphasis) → enumerated 8 canonical sites + explicit popover-CTA exclusion → spec contract
3. **Bottom-sheet smuggles 3 undefined contracts** (`<dialog>` vs live map underneath impossible; snap heights; focus management) → drop `<dialog>`; use `<div role="dialog" aria-modal="false">`; concrete snap heights → [`../01-spec/architecture.md`](../01-spec/architecture.md), [`../01-spec/accessibility.md`](../01-spec/accessibility.md)
4. **Filter chip strip lacks zero-state** → strip hidden at zero filters; chip removal via panel only → visual delta in v4 mocks
5. **Photo-as-anchor + LCP `loading="lazy"` conflict** → `priority` prop on `<Photo>`; masthead passes `priority={true}` → [`../01-spec/components.md`](../01-spec/components.md)
6. **"Arizona" wordmark hard-codes scope** → `REGION_LABEL` config in `frontend/src/config/region.ts` → [`../01-spec/architecture.md`](../01-spec/architecture.md)
7. **Freshness label has no fallback states** → 4-state machine (fresh / recent / stale / error) → [`../01-spec/voice-and-content.md`](../01-spec/voice-and-content.md)

### Loop 2 — System cohesion (6 kinks)

1. **Family-channel mechanism ambiguous** (CSS-only / JS-computed / DB-driven all in conflict) → JS-computed lookup table chosen; CSS path retired → [`../01-spec/components.md`](../01-spec/components.md), `frontend/src/config/family-palette.ts`
2. **Cluster pill thresholds undefined** (sample counts implied tiers but no boundary) → `count` is the prop; thresholds (sand 100 / ember 750) in `frontend/src/config/cluster.ts`; MapLibre layer imports same constants → [`../01-spec/components.md`](../01-spec/components.md)
3. **Token namespace collision** (v3 mock `--accent` would silently overwrite existing `--color-accent-notable-fg`) → `--accent` renamed `--color-decision-point` in production; lint guard fails CI on forbidden raw names → [`../01-spec/tokens.md`](../01-spec/tokens.md)
4. **`<StatusBlock>` × `<Photo>` boundary undefined** (who owns photo's loading state?) → they don't compose; `<Photo>` owns its own state machine; `<StatusBlock>` is page-level → [`../01-spec/components.md`](../01-spec/components.md)
5. **`<FilterSentence>` template diverged across surfaces** → unified single template; collapses to `null` at zero filters; feed's "Sorted by" becomes separate `<SortLabel>` → [`../01-spec/components.md`](../01-spec/components.md)
6. **Mobile Credits tab has no desktop equivalent** (compliance gap) → `[Attribution]` button in header on both viewports; mobile drops Credits tab; footer removed → [`../01-spec/architecture.md`](../01-spec/architecture.md)

### Loop 3 — A11y + final polish (6 kinks)

1. **Detail-modal heading is `<div>` not `<h1>`** → promote to `<h1 id="detail-title" tabIndex={-1}>` with `aria-labelledby` on dialog; initial focus on heading not close → [`../01-spec/accessibility.md`](../01-spec/accessibility.md)
2. **`<FilterSentence>` live-region debounce contract undefined** → 500ms debounce; "All filters cleared" hold for 1500ms; constants in `frontend/src/config/filter.ts` → [`../01-spec/components.md`](../01-spec/components.md), [`../01-spec/accessibility.md`](../01-spec/accessibility.md)
3. **Cluster pills color-only encoding (WCAG 1.4.1)** → `role="img" aria-label="{count} sightings"`; tier is decorative; count is canonical → [`../01-spec/components.md`](../01-spec/components.md)
4. **Bottom-sheet ARIA undefined across snap states** → role flips: `region` at peek/half, `dialog aria-modal="true"` at full; `inert` set on map BEFORE role flips → [`../01-spec/accessibility.md`](../01-spec/accessibility.md)
5. **No reduced-motion policy** → global `motion.css`; MapLibre easeTo JS guard → [`../01-spec/motion.md`](../01-spec/motion.md), [Phase 0](../02-phases/phase-0-pre-redesign.md)
6. **Notable affordance spec entry missing** → documented constraint: card layout + label text are non-color signals; `--color-accent-notable-fg` is amplification only → [`../01-spec/voice-and-content.md`](../01-spec/voice-and-content.md)

## 3 visual deltas (the mocks changed)

The remaining 16 kinks all became spec contracts with no visible-mock change. Three changed the visual:

1. **Mobile bottom tab bar 4 → 3 tabs**: Drop "Credits" tab; add "Attribution" link to header on both viewports
2. **Popover CTA loses accent**: "Open species detail →" changes from accent-orange to text-body underline (it's a link, not a primary CTA)
3. **Zero-filter mobile state defined**: Chip strip hidden entirely (not "+ Filter" placeholder); badge omitted (filter trigger reads "Filters" alone); filter sentence collapses; lede stays default

These three are visible in [`../04-visuals/v4-full.png`](../04-visuals/v4-full.png).

## Cross-cutting outcomes

The loops produced two cross-cutting structural outcomes that affect multiple spec sections:

1. **`frontend/src/config/` module emerges** — runtime parameters / taxonomies / lookup tables that drive visual or behavioral branching. Region, freshness, cluster thresholds, family palette, filter timings. Auditable single source of truth.
2. **Token namespace migration is the only fix that mutates existing code** (rather than adding new). All other Loop fixes are additive. Schedule the lint guard FIRST in implementation order to prevent silent regressions.

## How critique loops connect to phases

| Loop kink | Phase that ships the fix |
|---|---|
| L1 K1 (lede states) | Phase 5 (lede mounts on surfaces) + Phase 6 (templates rewritten in voice register) |
| L1 K2 (accent rule) | Phase 1 (token rename) + Phase 2+ (consumers respect rule) |
| L1 K3 (bottom-sheet) | Phase 4 |
| L1 K4 (filter chip strip) | Phase 5 |
| L1 K5 (`<Photo>` priority) | Phase 2 + Phase 4 (consumed by detail) |
| L1 K6 (`REGION_LABEL`) | Phase 1 (config) + Phase 6 (consumed by lede + wordmark) |
| L1 K7 (freshness) | Phase 2 (config + component) + Phase 6 (copy) |
| L2 K1 (family-channel) | Phase 2 (`getFamilyChannel`) |
| L2 K2 (cluster threshold) | Phase 2 (`<ClusterPill>` + `cluster.ts`) |
| L2 K3 (token namespace) | Phase 1 (lint guard FIRST) |
| L2 K4 (`<Photo>` × `<StatusBlock>`) | Phase 2 (boundary design) |
| L2 K5 (`<FilterSentence>` template) | Phase 2 (component) + Phase 5 (mounted) |
| L2 K6 (Credits prominence) | Phase 3 (header) + Phase 6 (footer removal) |
| L3 K1 (detail heading + focus) | Phase 4 |
| L3 K2 (live-region debounce) | Phase 2 (`<FilterSentence>`) |
| L3 K3 (cluster pill ARIA) | Phase 2 (`<ClusterPill>`) |
| L3 K4 (sheet role-switching) | Phase 4 |
| L3 K5 (motion policy) | Phase 0 (global rule + MapLibre guard) |
| L3 K6 (notable spec) | Phase 5 (notable card-row) |

## Cross-references

- Original loop outputs: [`../05-archive/critique-loops/loop-{1,2,3}-{critic,planner}.md`](../05-archive/critique-loops/)
- Decisions absorbed: [`../00-overview/decisions.md`](../00-overview/decisions.md)
- Visual deltas: [`../04-visuals/v4-full.png`](../04-visuals/v4-full.png)
