# Investigation: Visual & UX Audit

## Summary

The bird-maps.com default view communicates nothing interpretable to a first-time visitor: nine flat-coloured irregular polygons, 30 identical bird silhouettes in colour-differentiated circles, and eight grey "+N" overflow pips offer no narrative, no geographic anchor, and no legend. The expand interaction surfaces species names but renders them in typographic collision so severe that no individual name is fully readable. The Sky Islands fallback replaces the expand entirely with a giant grey disc occupying half the viewport, conveying zero information. Mobile reduces every already-marginal tap target by roughly 40% and adds 30% dead whitespace below the map. Five of these failure modes are inherent to the SVG-polygon-with-badge-grid metaphor; the remaining four are theoretically fixable but would require solutions complex enough to constitute a near-rewrite of the rendering stack.

---

## Key Findings

### Finding 1: The default view has no semantic entry point

- **Evidence:** `bird-maps-default-1440.png` — the viewport shows nine irregular polygons in shades of orange, brown, olive, and dark red against a beige background. There is no state border, no "Arizona" label, no city name, no compass rose, no scale bar, no region name, no legend. The filters bar (top-left) reads "Time window 14 days / Notable only / Family All families / Species Common name" — functional labels but they presuppose knowledge of what "family" means in ornithological terms.
- **Confidence:** High — directly observed in screenshot.
- **Implication:** A first-time visitor cannot determine what geography is shown, what the colours mean, or what the circles represent without external knowledge. The polygons do not resemble the recognisable silhouette of Arizona (the state outline is absent); the nearest visual reference most users carry — Arizona as an irregular rectangle — is not reinforced by any border. The spatial encoding carries zero self-explanatory load. Classification: **inherent to the metaphor** — the map requires continuous outlines, labels, and a basemap to function as a map; removing those elements in the name of minimalism does not produce a cleaner map, it produces a non-map.

### Finding 2: Colour encoding is unkeyed and ambiguous at two levels

- **Evidence:** `bird-maps-default-1440.png`, upper-right quadrant — the top badge row shows circles in dark navy, olive-brown, gold, purple, medium grey, light grey, red, salmon, and nearly-black. No legend is visible anywhere in the viewport. Additionally, three of the nine region polygons share the same fill `#B84C3A` (ground truth: `phase-0-packet.md` line 27: "Three regions share fill `#B84C3A`: sky-islands-chiricahuas, sky-islands-huachucas, sky-islands-santa-ritas"). In the lower-right of `bird-maps-default-1440.png`, those three Sky Island polygons cluster together; all three appear identical in fill, and the only disambiguation is their irregular polygon borders — which are also partially obscured by overlapping badges.
- **Confidence:** High — both colour facts are directly observable.
- **Implication:** Badge colour is the sole per-species visual differentiator (`App.tsx:28-30`, `silhouetteFor` returns `GENERIC_SILHOUETTE.path` unconditionally). A user who notices colour variation has no mechanism to decode it. They cannot determine whether a dark navy badge and a purple badge represent different families, different species, or different data attributes. The region colour confusion compounds this: the three Sky Islands look interchangeable, making even region-level selection spatially ambiguous. Classification: **colour legend — fixable within the metaphor** (add a legend); **three-regions-same-colour — fixable within the metaphor** (change fill values); however the generic silhouette problem — all birds look identical — is **inherent** until Phylopic per-species paths are integrated.

### Finding 3: Label collision in expanded view is total, not partial

- **Evidence:** `bird-maps-sonoran-tucson-expanded.png` — the expanded Sonoran-Tucson region shows four rows of four badges each. The species-name labels below each row of badges are rendered at the same SVG y-baseline, with `textAnchor="middle"` centred on each badge's x-position (`Badge.tsx:128-130`). The inter-badge horizontal pitch is `MAX_BADGE_DIAMETER + PADDING = 30 + 4 = 34` SVG units. At the scale of the expanded region, adjacent labels visually run together. The observable text in the screenshot reads: row 1: "Great Hbesdeny Cahyon Tantus" overlaid with "Wren" fragments; row 2: "Brown-dBreadel Black-thro" merged with "Pychu loxia"; row 3: "Dusky F" merged with "Black-Railfous-Winginia's War..."; row 4: "Greater" merged with "American" merged with "Dak S,Cooper's Hawk". Not a single label in the four visible rows is fully legible in isolation. The truncation logic (`MAX_LABEL_CHARS = 14`, `Badge.tsx:60`) clips longer names to 14 characters plus an ellipsis, but the ellipsis text itself ("Virginia's War...") is still wide enough to collide with its neighbours.
- **Confidence:** High — directly measured from the screenshot.
- **Implication:** The label collision is not a rendering bug that can be fixed with a CSS tweak. The root cause is geometric: `dominantBaseline="hanging"` positions the label immediately below the circle, but the horizontal pitch of adjacent badges (34 SVG units) is narrower than the rendered text width of a 14-character label at the font sizes computed from `Math.max(9, radius * 0.6)` (`Badge.tsx:132`). At `radius = 15` (MAX_BADGE_DIAMETER / 2), `fontSize = 9`. At 9px, a 14-character string is approximately 60–75px wide — roughly twice the 34-unit pitch when the SVG user-unit-to-CSS-pixel ratio at expanded scale is above 1. No label-aware layout algorithm exists in `BadgeStack.tsx`; `rowStride` is calculated as `MAX_BADGE_DIAMETER + PADDING + EXPANDED_LABEL_HEIGHT` where `EXPANDED_LABEL_HEIGHT = 14` (`BadgeStack.tsx:172-183`), which provides vertical separation between rows but does nothing about horizontal collision within a row. Classification: **inherent to the metaphor** — the badge-grid inside a polygon cannot provide the horizontal space that readable non-overlapping labels require without reducing the number of badges per row to 1-2, at which point the grid layout is no longer a grid.

### Finding 4: Sky Islands fallback is a pure information-destruction event

- **Evidence:** `bird-maps-huachucas-expanded.png` — on selecting the Sky Islands-Huachucas region, the expand-cap logic (`EXPAND_MAX_BBOX_FRAC = 0.6`, `Region.tsx:18`) triggers and the polygon scales to approximately half the viewport. The polygon is empty of badges; instead a single massive grey disc occupies the lower three-quarters of the polygon area. The disc contains the generic white bird silhouette path (same as every other badge) at roughly 200px apparent diameter. There is no species name. There is no count chip. The aria-label on the overflow pip reads "+1 more species — expand region to view" (`BadgeStack.tsx:242`) but the overflow pip is the only rendered element — there is no primary badge that would be meaningfully distinct. A user who clicks this region receives less information than was shown in the collapsed default view (where a single badge and an overflow pip were visible but at least implicitly invited further interaction).
- **Confidence:** High — directly observed; behaviour confirmed by `BadgeStack.tsx:189-258` (fallback branch).
- **Implication:** The pole-of-inaccessibility fallback was designed to guarantee containment for tiny polygons (`BadgeStack.tsx:94-98`). It achieves containment at the cost of all informational content. When combined with the expand-cap, the result is a workflow that is visually dramatic (large red polygon dominates the canvas) but informationally empty. The user has performed a deliberate interaction and been shown less. Classification: **inherent to the metaphor** — a polygon too narrow to contain a grid is also too narrow to contain readable labels; the fallback to a single unlabelled pip is the correct containment solution, but the expand interaction then scales that meaningless pip to fill half the screen.

### Finding 5: Mobile layout produces near-unclickable tap targets and wasted space

- **Evidence:** `bird-maps-mobile-390.png` — at 390px viewport width, the map renders at approximately 355px wide. The filters bar wraps to three rows (Time window, Notable only on one line; Family on second line; Species on third line), consuming approximately 140px of vertical space. The map itself occupies roughly 355×330px. Below the map, approximately 370px of beige whitespace is visible — empty, unused, carrying no content. Badges within the map shrink proportionally. The overflow pip "+35" in the upper-centre of the map is visibly readable but the individual badges around it are approximately 18-22px apparent diameter, well below the 44px WCAG 2.5.5 (AAA) and 24px WCAG 2.5.8 (AA) minimum tap target sizes. The Sky Islands cluster in the lower-right corner is a collision of overlapping badges and overflow pips at approximately 15-18px each.
- **Confidence:** High — directly observable; pixel measurements are approximate based on visual proportion.
- **Implication:** The 30% dead whitespace below the map is a direct consequence of the SVG having a fixed aspect ratio (`max-height: 100%; max-width: 100%`, `styles.css:75`) that doesn't fill the viewport on portrait-oriented phones. The tap target failure is partly fixable (increase `MIN_BADGE_DIAMETER`, `BadgeStack.tsx:65`) but increasing badge size in a fixed-area polygon means fewer badges fit before hitting the overflow threshold, which means less information is shown — a direct tradeoff that cannot be eliminated within the polygon-grid model. Classification: **dead whitespace — inherent to the metaphor** (SVG map with fixed aspect ratio on portrait viewport); **tap target size — fixable within the metaphor** at the cost of reduced information density.

### Finding 6: Spatial encoding is actively misleading

- **Evidence:** `bird-maps-default-1440.png` — badges are arranged in a regular grid within each polygon's largest inscribed rectangle (`BadgeStack.tsx:100-134`, `geo/path.ts:140-209`). The grid origin is the top-left corner of the inscribed rect, with badges filling left-to-right, top-to-bottom in observation-count order. No badge position corresponds to any geographic coordinate. The top-left badge in a polygon is not the northernmost or westernmost observation; it is simply the species with the highest count. However, the visual presentation places coloured circles inside polygon shapes at specific x/y positions — the same visual vocabulary used by every dot-density and proportional-symbol map the user has ever seen. A user trained on cartographic conventions will assume badge position encodes location.
- **Confidence:** High (spatial encoding convention is well-established); Medium (we cannot observe actual user behaviour from screenshots, only infer from visual vocabulary).
- **Implication:** The misleading spatial encoding is compounded by the absence of any alternative spatial anchor (no roads, no cities, no hotspot dots — the `HotspotDot` component is present in the codebase but 0 hotspot dots are visible in the default screenshot per `phase-0-packet.md` line 5). Classification: **inherent to the metaphor** — placing any symbol inside a geographic polygon creates a spatial inference; the only way to prevent the inference is to remove the polygon metaphor.

### Finding 7: No affordance for region clickability

- **Evidence:** `bird-maps-default-1440.png` — the polygon fills are flat colour with a white border stroke (`Region.tsx:118-119`). There is no hover state visible in a screenshot, no cursor indicator, no label, no visual cue that the polygon is an interactive element. The only interactions available are: clicking a polygon (selects it) and clicking a badge (opens species panel). Neither affordance is signalled in the default view. A user unfamiliar with the product has no way to know that clicking the orange area expands it, or that the circles are clickable.
- **Confidence:** High — the screenshot shows no hover states, labels, or interactive affordance markers.
- **Implication:** The `role="button"` and `tabIndex={0}` on `RegionShape` (`Region.tsx:123-126`) handle accessibility correctly for keyboard/screen-reader users, but provide zero visual affordance for mouse users. A cursor change to `pointer` is set (`style={{ cursor: 'pointer' }}`, `Region.tsx:133`) but is not visible in a static screenshot and is invisible to touch users on mobile. Classification: **fixable within the metaphor** — hover states, region labels, or onboarding tooltips could signal interactivity; but adding visible region labels introduces further label collision with badges.

### Finding 8: Overflow pip dominance obscures the primary data

- **Evidence:** `bird-maps-default-1440.png` — counting visible elements: 30 coloured species badges, 8 grey "+N more" overflow pips. The "+N more" pips carry numbers: +35, +25, +77, +67, +64, +12, +16, +5. Summing: the visible badges represent a maximum of 30 species; the overflow pips represent at minimum 301 additional species observations hidden from view. In the lower-right Sky Islands cluster, the dominant visual elements are three large grey pips (+64, +12, +16) that collectively report more hidden species than all visible badges combined. The map's primary data — what birds are present — is predominantly concealed.
- **Confidence:** High — directly counted from screenshot.
- **Implication:** The `MAX_COLLAPSED_BADGES = 12` cap (`BadgeStack.tsx:69`) is a containment policy, not an information policy. It prevents badge blowup but makes overflow the majority state for active regions. Classification: **inherent to the metaphor** — increasing the cap pushes badges into regions where they cannot be legibly rendered; decreasing the cap worsens the ratio.

### Finding 9: Filter bar vocabulary mismatch

- **Evidence:** `bird-maps-default-1440.png` (top bar) and `bird-maps-mobile-390.png` (wrapped filter rows) — the filter labels read "Time window", "Notable only", "Family", "Species". "Notable only" is an eBird-specific term of art; "Family" refers to taxonomic family (Accipitridae, etc.), not a colloquial grouping. The "Species" field accepts a common name typed free-form. No placeholder text in the Family dropdown explains that "All families" is the default. No tooltip or help text is present.
- **Confidence:** High — directly observed in screenshots.
- **Implication:** The vocabulary assumes ornithological literacy. A casual user browsing to see "cool birds in Arizona" will not recognise "family" as a useful filter axis, and "notable only" is unexplained. Classification: **fixable within the metaphor** — labels and tooltips can be added.

---

## Surprises

- The label collision in the expanded view is more complete than expected. Every visible label row in `bird-maps-sonoran-tucson-expanded.png` is illegible; this is not a few collisions at the edges but a systematic failure across the full grid. The `EXPANDED_LABEL_HEIGHT = 14` row-stride budget was addressed vertically but horizontal collision was never budgeted.
- The fallback path for Sky Islands-Huachucas renders the overflow pip as the *primary* visual element rather than a secondary annotation, at a diameter that dwarfs the polygon it annotates. The design intention (pole-of-inaccessibility guarantees containment) produces an artifact (giant grey disc) that reads as a crash or error state rather than meaningful data.
- The quantity of dead whitespace on mobile (roughly 370px below the map on a 844px viewport) is larger than the map itself. The map occupies less than 40% of the mobile screen despite being the sole content of the page.
- Zero hotspot dots are visible in the default view despite the backend serving `/api/hotspots` and `HotspotDot.tsx` existing as a component. This means the spatial encoding failure (badges look positional but are not) has no counterweight — there is no truly-geographic element in the view to calibrate the user's expectations.

---

## Unknowns & Gaps

- **Hover states:** The screenshots capture only the static/default state. Whether polygon hover provides a cursor change, fill-lightening, or tooltip is unknown from visual evidence alone. If hover does nothing visible, the affordance gap (Finding 7) is worse than estimated. A new screenshot with hover active would confirm this.
- **Selected badge state:** The `.badge-selected` style adds a `stroke: #1a1a1a; stroke-width: 4` ring (`styles.css:39`). Whether this is visually distinct enough at collapsed badge sizes (potentially 9-15px apparent diameter on mobile) cannot be determined without a screenshot of the selected state on a small region.
- **Species panel on mobile:** `styles.css:101-114` positions the species panel as `position: fixed; width: 320px` on the right side. On a 390px mobile viewport, this would cover all but 70px of the screen width. No screenshot shows the species panel open on mobile.
- **Actual WCAG contrast ratios:** The badge colours are family-derived. Without the full colour palette from `colorForFamily`, specific contrast ratios (badge fill vs. white silhouette, label text vs. polygon fill) cannot be measured from screenshots alone. The white silhouette on dark navy circles is likely sufficient contrast; the silhouette on gold/amber circles may not be.
- **Whether any user understands what they are looking at without prompting:** This is a UX research question that cannot be answered from visual analysis alone.

---

## Raw Evidence

- Screenshot read: `phase-0/screenshots/bird-maps-default-1440.png`
- Screenshot read: `phase-0/screenshots/bird-maps-sonoran-tucson-expanded.png`
- Screenshot read: `phase-0/screenshots/bird-maps-huachucas-expanded.png`
- Screenshot read: `phase-0/screenshots/bird-maps-mobile-390.png`
- Source read: `frontend/src/styles.css` (170 lines) — layout, transition, filter, label, and species-panel rules
- Source read: `frontend/src/components/Badge.tsx` (139 lines) — `DEFAULT_BADGE_RADIUS = 14`, `MAX_LABEL_CHARS = 14`, label rendering at `dominantBaseline="hanging"`, `fontSize = Math.max(9, radius * 0.6)`
- Source read: `frontend/src/components/BadgeStack.tsx` (333 lines) — `MAX_BADGE_DIAMETER = 30`, `MIN_BADGE_DIAMETER = 14`, `MAX_COLLAPSED_BADGES = 12`, `EXPANDED_LABEL_HEIGHT = 14`, pole-of-inaccessibility fallback branch at lines 189–258
- Source read: `frontend/src/components/Region.tsx` (176 lines) — `EXPAND_MAX_BBOX_FRAC = 0.6`, `parsePoints` silent drop of non-M/L commands, `computeExpandTransform` logic
- Context packet read: `phase-0-packet.md` — loadbearing facts lines 1-8 (silhouette, fill colours, DOM count, expand cap)
- Context packet read: `phase-0/analysis-brief.md` — Area 1 scope definition, known knowns lines 1-11
