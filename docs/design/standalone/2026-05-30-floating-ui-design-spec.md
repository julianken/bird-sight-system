# Bird Maps — Holistic Floating-UI Design Spec

**Status:** Design source of truth for the map-first re-architecture (epic #761, Stage 2).
**Scope:** Every floating surface over the edge-to-edge map — header, scope control, context strip, family legend, filters, attribution, popovers, detail surface.
**Date:** 2026-05-30. **Author:** Lead designer (synthesis of four design-lens audits + the `.tmp-shots/holistic-audit` live captures).

This spec replaces "patch each element" with one coherent system. Every section below is concrete: real token names, real values, real anchors. Implementers build *against this*, not against the four critiques individually.

---

## 1. Design intent & the Google-Maps idiom

**The map is the application.** `#map-layer` is the viewport root (`position: fixed; inset: 0; z-index: 0`) and the basemap is genuinely edge-to-edge under everything — that foundation is correct and stays. Everything else is **discrete, corner-anchored floating cards over that map**: rounded, inset from the viewport edge by a single shared gutter, lifted by a shared elevation system that works on *both* the light cream basemap and the near-black dark basemap. There is **no top bar, no edge dock, no full-bleed band** anywhere in the system. The center of the screen always belongs to the map; chrome lives in the four corners. When you open something (detail, filters, a popover), you add a *floating island*, you never carve the map into panels. The north-star reference is Google/Apple Maps: a search/identity cluster top-left, controls top-right, a results/legend card bottom-left, attribution bottom-right, popovers that flip to stay on-screen, and a live map visible through everything.

Two current elements violate this at the structural level and are the headline fixes: the **AppHeader is a full-width top dock** (must dissolve into two corner clusters) and the **SpeciesDetailRail is a full-height right-edge dock** (must become an inset floating card). A third, the **context strip / lede**, is *invisible today* — authored as an in-flow band that the absolutely-positioned map canvas paints over — and must be rehomed as a real floating card.

---

## 2. The floating-card design language (the shared system)

Every floating surface consumes **one** vocabulary. No element invents its own radius, shadow, inset, or fill. These become CSS tokens in `tokens.css` (mode-paired in the `[data-theme]` blocks) plus a small Layer-3 `--card-*` alias family. This collapses today's **8 ad-hoc box-shadows, 3 card radii, and 2 divergent token vocabularies** into a single contract.

### 2.1 Geometry tokens (mode-independent, on `:root`)

```css
:root {
  /* Floating-card geometry — the one card language */
  --card-radius:        12px;                 /* retires 6px/8px for cards. Reuse existing --radius-lg */
  --card-radius-inner:  8px;                  /* nested controls inside a card (inputs keep 4px) */
  --card-inset:         var(--space-md);      /* 12px — the gutter EVERY anchored card leaves from the viewport edge */
  --card-inset-wide:    var(--space-xl);      /* 24px — corner inset at ≥1440 so wide screens read intentional */
  --card-gap:           var(--space-sm);      /* 8px — gap between stacked cards in the same corner */
  --card-padding:       var(--space-md) var(--space-lg);   /* 12px 16px */
  --card-padding-tight: var(--space-sm) var(--space-md);   /* 8px 12px — pills, popover rows */
  --card-maxw-identity: 360px;                /* top-left identity+scope cluster cap */
  --card-maxw-legend:   280px;                /* legend cap */
  --card-maxw-rail:     420px;                /* detail card cap (max(420px, 38vw) clamp below) */
  --card-maxw-popover:  300px;
}
```

`--header-height: 48px` stays defined but **stops being a layout reservation** — nothing reserves flow height anymore; it's only used as a vertical-offset reference where a card needs to clear the top-left cluster.

### 2.2 Surface tokens (already mode-paired — reuse, don't duplicate)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--card-bg` → `--color-bg-surface` | `#ffffff` | **`#1b2742`** (lift from today's `#131c30`) | card fill |
| `--card-border` → `--color-border-ui` | `#d8d3c3` | **`#3a4668`** (lift from `#283354`) | 1px hairline edge |
| text → existing `--color-text-*` | unchanged | unchanged | unchanged |

The dark fill and border are **deliberately lifted** (`#131c30 → #1b2742`, `#283354 → #3a4668`). A card sitting only ~6 luminance points off the `#0d1424` basemap cannot separate by shadow alone on a near-black ground — the fill itself must read as "lifted." This is the primary mechanism that fixes dark-mode separation; elevation is secondary.

### 2.3 The elevation system (the load-bearing fix)

Three tiers, **mode-paired**. Dark elevation is **not** "more black alpha" (invisible on a black map) — it is **ambient drop shadow + a top inner rim-light**, the way Google/Apple dark map UIs lift cards.

```css
:root[data-theme="light"] {
  --elevation-1: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
  --elevation-2: 0 4px 12px rgba(0,0,0,0.15);
  --elevation-3: 0 12px 32px rgba(0,0,0,0.22);
}
:root[data-theme="dark"] {
  --elevation-1: 0 1px 3px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05);
  --elevation-2: 0 4px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06);
  --elevation-3: 0 14px 36px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.07);
}
```

**Tier assignment** (every floating surface picks exactly one):

| Tier | Surfaces | Token |
|---|---|---|
| **1** — resting chrome | header clusters, scope control, family legend, context card | `--card-elevation-1: var(--elevation-1)` |
| **2** — on-canvas transient | observation / cell / cluster popovers | `--card-elevation-2: var(--elevation-2)` |
| **3** — focused / modal | detail card, bottom sheet, attribution modal, scope chooser, filters panel | `--card-elevation-3: var(--elevation-3)` |

The header gains real elevation (it has **none** today) by adopting tier 1. The `border-bottom` survives only as the light-mode hairline.

### 2.4 Typography (reuse the existing ramp — no new sizes)

- Card title: `--type-md` 17px / `--font-weight-semibold`.
- Card body & rows: `--type-sm` 13px / regular.
- Meta / freshness / attribution: `--type-xs` 11px / `--color-text-subtle`.
- **Wordmark + region suffix (AMENDED — see ruling note below): `--type-md` bold** for the "Bird Maps" brand, with the region riding as a muted `--font-weight-medium` ` · Arizona` suffix on the same line (`--color-text-muted`). The "N species · updated" line is `--type-sm`. The brand/region wordmark is the resting identity row of the top-left card.

  > **Amendment (Julian, 2026-06-11):** *"we got rid of the concept of region — this is drift."* The original §2.4/§5.2 mandate — a `--type-lg` 22px region name asserted as the loudest text on a scoped view — was never shipped. #828 shipped a two-line wordmark instead: the brand at `--type-md` bold, the region as a quiet muted suffix, and an `.sr-only` `<h1>` that carries the page's heading structure without painting. The spec is amended here to describe that shipped reality; the matching "whispered-region" visual finding closes **by-design**. No typography change ships from this amendment.

### 2.5 Token-debt cleanup that ships *with* this language

- **Define or replace the four undefined tokens** consumed by `ds-primitives.css` (`--color-border-strong`, `--color-text-link`, `--text-body-sm`, `--text-heading-sm`) — they resolve to nothing today, so the cell/cluster popovers silently inherit. Either define them mode-paired in `tokens.css` or rewrite usages to `--color-border-ui` / `--type-sm` / `--type-md`. Required so the two map popovers a user toggles between are visually identical.
- **Correct the `ds-primitives.css` "no raw hex" header comment** once its shadows become `var(--card-elevation-2)`.
- Keep `4px` strictly for inner inputs/buttons; cards are `12px`, nested controls `8px`. Retire `6px`/`8px` *as card radii*.

---

## 3. Spatial composition map

**The contract: four corners + a transient layer. The map owns the center.** Write this four-corner map into `tokens.css` comments and CLAUDE.md so every future floating element is *assigned a corner*, never a new band.

| Anchor | Owns | Cap |
|---|---|---|
| **Top-left** | Identity+scope cluster: wordmark `Bird Maps`, region label `Arizona`, the lede (`331 species · updated 20 min ago`), and the scope control (state select / ZIP / Change-scope), as **one stacked card** | `--card-maxw-identity` 360px |
| **Top-right** | Controls cluster: Filters (labeled at ≥1024), Attribution, theme toggle — a compact pill group | content-width |
| **Bottom-left** | Family legend | `--card-maxw-legend` 280px |
| **Bottom-right** | Minimal always-visible attribution line — `OpenFreeMap · eBird` (license floor) at `--type-xs`, as a small `.map-attribution` floating island. *(#828 relocated the always-visible eBird credit here after deleting the identity-card freshness line that #830 had parked it in; the full credits — OSM / OpenMapTiles / OpenFreeMap / eBird / PhyloPic / photos — stay in the top-right ⓘ Credits modal. Future zoom/locate shares this corner.)* | content-width |
| **Transient** | Popovers (flip/shift to stay on-screen), detail card (insets top-right region; the **Sightings Log** §4.5.1 is a section *of* this card, not a new surface), filters panel (anchored under its trigger) | per-element caps |

### Desktop (1440 / 1920)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ┌─────────────────────┐                         ┌────────────────────┐ │  ← --card-inset-wide (24px)
│ │ Bird Maps           │                         │ Filters · ⓘ · ☀ │ │     gutters; both are tier-1 cards
│ │ Arizona             │                         └────────────────────┘ │
│ │ 331 species         │                                                 │
│ │ updated 20 min ago  │            (map owns the center)                │
│ │ ─────────────────   │                                                 │
│ │ [Arizona ▾] [ZIP]   │                                                 │
│ │ Whole US · Change   │                                                 │
│ └─────────────────────┘                                                 │
│                                                                         │
│ ┌──────────────────┐                                                    │
│ │ Bird families ▴  │                                                     │
│ │ 🪶 Parrots    5  │                              (bottom-right reserved │
│ │ 🦉 Barn-Owls 12  │                               for zoom/locate; attr │
│ └──────────────────┘                               in ⓘ modal — #830)   │
└──────────────────────────────────────────────────────────────────────┘
```

With the **detail card open**, it insets into the top-right region *below* the controls cluster, the map still wrapping it on all four sides:

```
│                                          ┌────────────────────┐         │
│                                          │ Filters · ⓘ · ☀ │         │  ← controls stay above
│                                          └────────────────────┘         │
│                                          ┌────────────────────┐         │
│                                          │ Western Kingbird   │         │  ← detail card, tier-3,
│   (map stays live, wraps the card)       │ Tyrant Flycatchers │         │     inset, NOT edge-docked
│                                          │ …                  │         │
│                                          └────────────────────┘         │
```

At **1920** the only change vs 1440 is wider corner insets (`--card-inset-wide`) and **capped card widths** — cards do not balloon, the map breathes more. The empty center is *intentional* (the map owns it), not "one bar + a lot of nothing."

### Mobile (390)

One corner stack per region, **at most one expanded surface at a time** (see §5). The center stays map.

```
┌──────────────────────┐
│ Bird Maps   ⓘ ⛛ ☀ │  ← top-left wordmark pill + top-right icon pill, both inset --card-inset (12px)
│ [Arizona ▾]          │  ← scope collapses to ONE "Arizona ▾" pill under the wordmark
│                      │
│      (map)           │
│                      │
│ ┌──────────────────┐ │
│ │ Bird families ▾  │ │  ← legend, collapsed-by-default below WIDE; at
│ └──────────────────┘ │     --card-inset (no attribution bar to clear — #830)
│                      │  ← bottom-right reserved (zoom/locate); full attr in ⓘ modal
└──────────────────────┘
```

When a **bottom sheet** (detail or filters) is up, the legend auto-collapses to its chevron pill and shifts so it never overlaps the sheet. (At half/full it is force-collapsed; at peek it lifts above the peek strip — #830. There is no longer an attribution band to clear.)

---

## 4. Per-element treatment

### 4.1 Header → two floating corner clusters *(PRINCIPLE-VIOLATOR #1 — full-width top dock)*

- **Today:** `position: fixed; top/left/right: 0; border-bottom: 1px`, no shadow, a lone centered "Map" tab in a flex-1 void, and the right cluster gets sliced by the detail rail.
- **Target:** Delete the edge-to-edge bar. Render **two independent tier-1 cards** inside `#map-layer` at `--z-chrome` (42):
  - **Top-left cluster** = wordmark `Bird Maps` + region `Arizona`, merged with the **scope control and the lede** into one stacked card (see 4.2/4.3). Anchor `top/left: var(--card-inset)` (→ `--card-inset-wide` at ≥1440).
  - **Top-right controls** = Filters · Attribution · theme, a compact pill group. Anchor `top/right: var(--card-inset)`.
- **Remove** the vestigial one-tab tablist entirely — it carries no navigation and creates the dead center.
- Both clusters use `--card-bg / --card-border / --card-radius / --card-elevation-1`. The map fills 100% between them.
- **Responsive:** ≥1024 Filters is a labeled control; <1024 it's an icon. <480 wordmark collapses to brand + region pill; controls collapse to icons.

### 4.2 ScopeControl → folded into the top-left cluster (not a second band)

- **Today:** top-center pill at `inset-block-start: calc(var(--header-height) + var(--space-md))` — a second horizontal band stacked under the header, occluding the top ~110px of map. The offset exists *only* to dodge the fixed header.
- **Target:** Move into the top-left identity card as its bottom rows: `[Arizona ▾] [ZIP]` then `Whole US · Change scope`. **Delete the header-height offset** — once the header is corner-anchored, the regression it compensated for is gone. This reclaims the top band and gives one coherent "where am I / change where" control, Google-Maps top-left-search style.
- It is **de-emphasized** (matches `ScopeControl.tsx:16`): it sits *below* the lede, smaller, as a "change" affordance — not the loudest card on the map.
- **Responsive:** <480 collapses to a single `Arizona ▾` pill that expands the scope rows on tap.

### 4.3 Context strip / lede → the top-left card's identity rows *(currently INVISIBLE — blocker)*

- **Today:** authored as an in-flow opaque `border-bottom` band rendered *before* `.map-surface`; because `.map-surface` is `absolute; inset: 0` it paints over the strip → the app's primary orientation sentence is **not visible at any width**.
- **Target:** Stop rendering it in flow. Fold the lede + freshness into the **top-left identity card** as its headline rows: the `--type-md` bold wordmark with its muted ` · region` suffix (per §2.4 as amended — the original `--type-lg` region mandate was never shipped; #828's two-line wordmark is the shipped design), then `331 species · updated 20 min ago · eBird` at `--type-sm`/`--type-xs`. Drop the opaque band / `border-bottom` entirely — it was built for a document-flow layout that no longer exists.
- This is the single highest-value content fix: it makes the lede exist again **and** makes it the primary text (see §5).

### 4.4 FamilyLegend → keep (the one correct island), formalize

- **Today:** the *only* element already in the right idiom — bottom-left, rounded, shadowed, capped at 240px. Keep the anchor.
- **Target:** Migrate its hardcoded `--shadow-listbox` 6px to the shared language: `--card-radius` 12px, `--card-elevation-1`, `--card-maxw-legend` 280px, anchored `bottom/left: var(--card-inset)`. (Post-#830 there is no attribution band to clear; the only bottom-sheet interaction is the peek-snap lift.)
- **Responsive:** **single expansion authority** — default expanded only above `--overlay-bp-wide` (1024), collapsed below. Delete the divergent dual control (JS-1024 *and* CSS-760) that leaves it expanded over the southwest markers at 768. Below WIDE it's a chevron pill; localStorage override persists user choice.

### 4.5 SpeciesDetail → inset floating card / bottom sheet *(PRINCIPLE-VIOLATOR #2 — full-height right dock)*

- **Today:** `position: fixed; top:0; right:0; bottom:0; width: min(560px,100vw); border-left` — a 3-edge wall that slices the viewport into "map | panel," passes *under* the header (`z-rail 43 > z-chrome 42`, top:0), and its close button collides with the header band.
- **Target (desktop):** an **inset floating card** — `top: calc(var(--card-inset) + controls-cluster-height + var(--card-gap)); right/bottom: var(--card-inset); width: clamp(360px, 38vw, 420px)`; `--card-radius` on all four corners, `--card-elevation-3`, **drop `border-left` for a floating shadow**. The map visibly wraps it on all sides — preserving the "map stays interactive beside detail" intent (#663) and never slicing the top-right controls.
- **Target (mobile):** keep the bottom **sheet** (Apple-Maps idiom) with peek/half/full snaps, `--card-radius` top corners, `--card-elevation-3`. Reconcile its raw z (10/15/20) onto `--z-modal` (50) at full snap so the `pointer-events:none` header hack can be retired.
- **Responsive:** anchored card ≥`--overlay-bp-compact` (480); bottom sheet below.

#### 4.5.1 Sightings Log — per-sighting recency *inside* the detail surface (epic #1299)

> **Ship position (design-intent-first):** this subsection records the *intended* contract ahead of the sibling code PRs that land it (B1 #1300 + F2 #1301 merged; F3 #1302 wires the zoom<6 cell path) — it documents intended, not yet-shipped, behavior, intentionally.

The Sightings Log is a **section of the SpeciesDetail card**, not a new floating surface: it claims **no new corner** and adds no band. In the four-corner anchor contract (§3) it lives entirely inside the **Transient** detail card (Rail tier-3 / mobile full detent at `--z-modal` 50). It lists the *individual* sightings of the selected species under the clicked marker — recency the count-rollup popovers (§4.7) cannot show — as one static row each.

- **Placement.** Immediately **after the family-accent rule, above the taxonomy `<dl>`** (desktop Surface and mobile Sheet alike). Per-sighting recency for the clicked marker outranks formal taxonomy reference data, so it sits high. On **mobile it is full-detent-only**, matching taxonomy/About (it does not appear at peek/half).
- **Row vocabulary.** Each row reads **time · exact location · count · notable**:
  - **time / location** formatting **mirrors `ObservationPopover`** (same locale time string, same `locName`); the section reuses `ObservationPopover` tokens — **no new colors**.
  - **count** is a **deliberate divergence from `ObservationPopover`**: the popover shows a count whenever `howMany != null` (it will render "Count: 1"); the log shows the count column **only when `howMany > 1`**. A solo bird carries no count chrome.
  - **notable** renders a `!` marker (aria-labelled "Notable") when `isNotable`.
- **Row cap.** Client-side `MAX_VISIBLE_ROWS = 50` — a busy single-species cluster could otherwise materialize an arbitrarily long list in the Rail. Overflow (and the zoom<6 server-truncation case) surface a single **"latest N of M"** banner; the cap is a plain `slice` (no virtualization).
- **Motion (#953).** Rows are **static — never animate the counts.** The sighting counts are camera-coupled (a pan/zoom changes which leaves are in view), so animating them would strobe on every map move; this section inherits the same count-animation prohibition the lede and legend carry.
- **Zoom-fork data path.** The rows are sourced one of two ways, by the **floored integer** map zoom that produced the markers:
  - **zoom ≥ 6 — client-side cluster leaves, no fetch.** The already-cached cluster leaves (or the single clicked observation) are filtered to the selected species and projected to a narrow `SightingRow` (six fields). Cluster leaves never carry `locId`, so a full `Observation` cannot be reconstructed — both seams (the single-observation popover seam and the cluster-leaf seam) agree on this same projection.
  - **zoom < 6 — `GET /api/observations/cell` (single-bucket `ClusterListPopover` / unclustered-point seam ONLY).** When the markers are server-aggregated grid cells, the log fetches the cell's per-sighting rows via the popover opened by clicking an isolated (unclustered) single grid bucket rendered as a canvas `unclustered-point` — i.e. the single-bucket `ClusterListPopover` seam. A genuine single grid bucket renders as an unclustered-point leaf (maplibre's supercluster never emits a 1-point cluster), so the handler is `ClusterListPopover`, not `CellPopover`. The log fetches: bounded `LIMIT 200` (`CELL_OBSERVATIONS_LIMIT`), `count(*) OVER ()` as the exact pre-LIMIT denominator M, `truncated` + the "latest N of M" banner, ordered `obs_dt DESC`, and matching the **map's active since-window**. The cell is identified by a `round(coord*m)/m` bucket center (the same `gridMultiplierForZoom` mapping the server uses), so the fetched cell agrees with the server's bucketing by construction.
  - **Non-goal: the multi-bucket `ClusterListPopover` context.** When a `ClusterListPopover` summarizes *many* cells, its centroid is **not** a `round(coord*m)/m` bucket center, so the single-cell route cannot serve it. The log renders nothing for that context (`supported: false`). A future cluster-bbox / multi-cell query is a **separate effort**, not part of this contract.
- **The three decisions.** (1) **Display-only rows** — no row links, no row-level navigation. (2) **Coexists with the count-rollup popovers** (§4.7) rather than replacing them — the popovers answer "how many here", the log answers "which sightings, when, where". (3) **High placement** — directly under the family-accent rule, above formal taxonomy.
- **No schema / migration.** B1's `GET /api/observations/cell` reads existing `observations` rows; no new table or column.
- **Design intent reference:** Figma file `AhfeWpBSVNI2IhjMiLrmpe`.

### 4.6 Filters → anchored floating panel / bottom sheet

- **Today:** a full-bleed flow band (`display:flex; border-bottom`, no position/radius/shadow) that **displaces the map downward** on open.
- **Target (desktop):** an **anchored panel** under the Filters trigger in the top-right cluster — `--card-radius`, `--card-elevation-2`, a close affordance, never a top band; the map never jumps.
- **Target (mobile):** promote to a **bottom sheet** reusing the detail-sheet snap mechanics.
- **Responsive:** switch anchored-card ↔ sheet at `--overlay-bp-compact` (480) — the shipped single switch boundary.

### 4.7 Popovers (observation / cell / cluster) → one primitive with edge-collision

- **Today:** the single-observation popover has flipX; the **cluster popover has no positioning logic** and inherits the transformed MapLibre marker box → a west-edge marker pushes it off-screen, clipped to one word per line (`cluster-popover-1440-light.png`).
- **Target:** one shared anchored-popover primitive used by all three. Flip/shift against the viewport, **clamped to the `--card-inset` safe-area** (accounting for the floating header, scope cluster, and legend), with a caret that points to the anchor and survives the flip. All consume `--card-radius`, `--card-elevation-2`, `--card-bg/border`.
- **Responsive:** anchored popover on fine pointers; bottom sheet on coarse/`--overlay-bp-compact`.

### 4.8 Attribution → minimal bottom-right credit + full credits in the ⓘ Credits modal, and the scope-chooser scrim

- **Attribution (#830 consolidation, revised by #828):** #830 removed the old full-width MapLibre attribution *bar* and put the always-visible eBird credit in the identity-card freshness line. #828 then deleted that freshness line, so the always-visible license-floor credit moved to the **bottom-right corner** as a minimal `.map-attribution` floating island — `OpenFreeMap · eBird`, both linked, at `--type-xs` on a small `--color-bg-surface` pill (anchored `bottom/right: var(--card-inset)`, gated on map-visible so the eBird credit shows whenever observation data is on the map). The full credits (OSM / OpenMapTiles / OpenFreeMap / eBird / PhyloPic / photos) still live in the top-right ⓘ Credits modal; the OSMF Attribution Guidelines sanction the labeled ⓘ button for the *complete* OSM credit. This is explicitly **not** a return to the full-width bar #830 removed — it is a small corner island consistent with the four-corner contract. The legend still sits at `--card-inset` (the retired `--attribution-clearance` lift stays gone — the bottom-left legend and bottom-right credit do not collide; the only bottom-sheet interaction is the peek-snap legend lift).
- **Scope-chooser (landing):** lower the scrim from ~92% opaque toward **~60–70%** (optionally `backdrop-filter: blur(2px)`) so the live map reads clearly behind the chooser card — signaling "pick a place *on this map*." The card stays opaque `--card-bg` so card-text AA is unaffected. Card adopts `--card-radius` / `--card-elevation-3`.

---

## 5. Responsive & hierarchy rules

### 5.1 One placement authority, three breakpoints

Build the layer the tokens already name; **delete every per-component @media** (`MapSurface.tsx:42`, `styles.css:837/1886/1405`) and source all placement from:

- **COMPACT `< 480`** — single bottom-stack; **at most one expanded surface**; everything else is a collapsed pill.
- **ROOMY `480–1024`** — corner-anchored cards, **max one card per corner**.
- **WIDE `> 1024`** — corner-anchored, **capped widths** (§2.1), `--card-inset-wide` gutters, more map breathing room.

### 5.2 Visual hierarchy (fix the inversion)

The pre-redesign inversion put a utility (scope control, top-center) loudest. Correct ranking, loudest → quietest (amended per the §2.4 region ruling — the region rides as a muted wordmark suffix by design, NOT as a `--type-lg` headline):

1. **Identity** — the `--type-md` bold wordmark with its muted ` · region` suffix, plus the `N species · updated` line. *Primary.* (Amended #828: the region is a quiet suffix on the wordmark line, not a `--type-lg` headline — see §2.4's amendment note.)
2. **Filters** — what's shown; labeled control at ≥1024, not a 20px icon. *Primary-secondary.*
3. **Scope control** — de-emphasized "change where" rows under the lede. *Secondary.*
4. **Legend / attribution.** *Tertiary.*
5. **Popovers / detail.** *Transient.*

### 5.3 Collision avoidance (system rules, not per-element patches)

- **Mobile single-surface discipline:** when detail or filters sheet is at peek/half/full, auto-collapse the legend to its chevron pill and the scope to its `Arizona ▾` pill. Never show expanded legend + full scope + sheet at once.
- **Bottom-stack manager (≤480):** track sheet height in a CSS var; offset the legend's `bottom` by it (or shift legend bottom-right) so the two never overlap. (The 60px attribution safe-zone clause is retired — the attribution bar was removed in #830; the legend lifts above the peek strip via `body:has(.species-detail-sheet--peek) .family-legend`.)
- **Detail never occludes controls:** the inset detail card sits *below* the top-right cluster (z and offset), never slicing it.
- **Popover edge-collision:** one shared flip/shift/clamp helper (§4.7).
- **Clean z-ladder:** `--z-map 0 < --z-overlay 40 (legend, scope, context) < --z-popover 41 < --z-chrome 42 (header clusters) < --z-rail 43 (detail card) < cell 44 < cluster 45 < --z-modal 50 (full sheet / modal)`. The detail card and full-snap sheet move onto this ladder so "what floats over what" is predictable; the `pointer-events:none` header hack is removed.

---

## 6. Mapping to the plan

### 6.0 Foundation FIRST — new shared work, before any element PR

A **`feat(tokens): floating-card design language` PR** must land before #800/#801/#779/#780/#783, or the elements will diverge again. It adds to `tokens.css`: the `--card-*` geometry family (§2.1), the mode-paired **`--elevation-1/2/3`** scale (§2.3), the **lifted dark `--color-bg-surface` / `--color-border-ui`** (§2.2), and resolves/replaces the four undefined `ds-primitives.css` tokens (§2.5). It writes the **four-corner anchor contract** into `tokens.css` comments + CLAUDE.md. No visual element moves in this PR — it's pure foundation so every downstream PR is a token-consumption change, not a restyle.

A second small foundation PR, **`feat(overlay): placement breakpoint engine`**, wires `--overlay-bp-compact/wide` to real rules and deletes the divergent per-component thresholds (§5.1). This unblocks the responsive behavior every element depends on.

### 6.1 Existing epic #761 issues — retargeted per this spec

| Issue | Was | **Now targets** |
|---|---|---|
| **#800 — header → clusters** | header full-width bar | **§4.1** Dissolve the bar into a top-left identity cluster + top-right controls pill; remove the one-tab tablist; adopt `--card-*` + `--card-elevation-1`; header gains real elevation. *Fixes principle-violator #1.* |
| **#801 — rail → inset card** | right-edge dock | **§4.5** Inset floating card desktop (`clamp(360px,38vw,420px)`, all-corner radius, `--card-elevation-3`, no border-left, sits below controls); bottom sheet mobile reconciled to `--z-modal`. *Fixes principle-violator #2.* |
| **O3 #779 — context → card** | in-flow band | **§4.3** Stop in-flow rendering; fold lede + freshness into the top-left identity card as the **primary** headline rows. *Fixes the invisible-lede blocker.* |
| **O4 #780 — filters → sheet** | full-bleed band | **§4.6** Anchored panel under the Filters trigger (desktop) / bottom sheet (mobile) via the breakpoint engine; never displaces the map. |
| **O5 #783 — legend / sheet** | legend collapse + sheet z | **§4.4 + §5.3** Single 1024 expansion authority; migrate legend to `--card-*`; bottom-stack manager + `--z-modal` reconciliation retiring the pointer-events hack. |

### 6.2 New issue to file

- **O6 — shared anchored-popover primitive (§4.7):** one primitive for observation/cell/cluster popovers with flip/shift/clamp edge-collision and a caret. Folds in the cluster-popover clipping fix and unifies the two token vocabularies for popovers. (Depends on §6.0 foundation.)
- **Scrim translucency (§4.8)** can ride on #800 or O3, or be a tiny standalone PR.

### 6.3 Recommended implementation order

1. **`feat(tokens): floating-card design language`** (§6.0) — geometry, elevation, lifted dark surfaces, undefined-token cleanup, four-corner contract. *Blocks everything.*
2. **`feat(overlay): placement breakpoint engine`** (§5.1) — wire `--overlay-bp-*`, delete divergent thresholds. *Blocks responsive behavior.*
3. **#800 header → clusters** + **O3 #779 lede into the top-left card** *(ship together — they share the top-left identity card and removing the bar is what un-occludes the lede).*
4. **#801 rail → inset card** *(depends on the header clusters existing, so the detail card can sit below the controls).*
5. **O4 #780 filters → anchored panel / sheet** *(depends on the breakpoint engine and the top-right controls cluster).*
6. **O5 #783 legend authority + bottom-stack manager + z-reconciliation.**
7. **O6 shared popover primitive + edge-collision** *(can run in parallel after step 1).*

Steps 3–7 are each one-PR, each a token-consumption change against the step-1/2 foundation — which is what makes the result land as one coherent Google-Maps-grade floating system instead of seven independently-styled overlays.

---

Relevant files: spec applies to `/Users/j/repos/bird-watch/frontend/src/styles/tokens.css` (new `--card-*` / `--elevation-*` tokens, lifted dark surfaces), `/Users/j/repos/bird-watch/frontend/src/styles.css` (header, scope, legend, rail, filters, context strip), and `/Users/j/repos/bird-watch/frontend/src/components/ds/ds-primitives.css` (popover token cleanup + shared primitive). Captures reviewed in `/Users/j/repos/bird-watch/.tmp-shots/holistic-audit/`.