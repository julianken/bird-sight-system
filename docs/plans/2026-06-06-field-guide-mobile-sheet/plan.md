# Field-Guide Mobile Species-Sheet — Production Implementation Plan

Status: ready to execute (**rev 2** — folds in the architecture / a11y / test-ci adversarial
reviews of rev 1; every mustFix is addressed inline and tagged `[R2-fix]`). Source of truth for
the visual + motion direction is `./mid-full-redesign.md` (locked
**Direction B — Field-guide**, borrowing Editorial's captioned-figure discipline at full).
Root-cause + a11y findings: `diagnosis-report.md`. Design/a11y tuning: `fg-tuning-punchlist.md`.

The prototype lives uncommitted on `proto/mobile-sheet-strategy-2`. Production tasks branch
off `main`. This plan ports the prototype's proven shape into production-grade code, folds in
the F8/F9/F10 a11y work and the remaining punch-list items, and keeps the CI gate
(`test` / `lint` / `build` / `e2e` + `knip` + `orphan-classname-check`) **green on every PR** — no
task may leave any required check red for a later PR to repair.

> **Verified-ground-truth note (rev 2).** Every file path, line number, prop signature, and DOM
> shape below was checked against the working tree on `proto/mobile-sheet-strategy-2` on
> 2026-06-06. Where rev 1 asserted a fact the source contradicts, the correction is called out
> with `[R2-fix]` and the verifying file:line. Implementers: trust this revision's paths over any
> remembered ones, and over the decoy copies under `.claude/worktrees/`.

---

## 1. Goal + scope

**Ships:** the mobile (`useIsCompact()` ≤1199px) `SpeciesDetailSheet` becomes a three-detent
field-guide sheet:

- **peek / compact** — the loved identity row (44px photo + comName + family), ~104px.
- **half / mid** — the field-guide "plate card": 120px square plate, identity spine, 3px
  family accent rule, two-cell `<dl>` field-record strip (Family · eBird taxonomic order),
  2-line teaser with a real "Read account" `<button>`.
- **full / dialog** — the field-guide entry: full-bleed 16/10 masthead, hero name, accent
  taxon rule, 3-row `<dl>` taxonomy table, "About" prose via `<SpeciesDescription>`, credits.

Plus the motion (height-driven 1:1 drag, velocity flick, dismiss, single-element photo morph,
texts/panel reveal) and the a11y contract (focus trap at full, focus restore on close,
announce-on-reaching-a-readable-detent).

### 1.1 Desktop decision — SHEET-ONLY. Do not touch the rail/modal layout.

`SpeciesDetailSurface` is shared by `SpeciesDetailRail` (≥1200px, the live desktop surface) and
the dead-but-tracked `SpeciesDetailModal`. The prototype deliberately stopped composing
`SpeciesDetailSurface` inside the sheet and inlined a parallel field-guide DOM tree
(`.sheet-fg-*`). **We keep that split** for the *page-level layout* (grid, detents, scroll,
dismiss). Rationale:

- The four-corner anchor contract and the `#801` inset-floating-card rail are desktop-only and
  orthogonal to the detent model — the rail has no detents, no drag, no peek.
- Adopting the field-guide layout into `SpeciesDetailSurface` would force a simultaneous rail
  redesign and re-baseline of `SpeciesDetailSurface.test.tsx` (25KB) + the desktop half of
  `species-detail.spec.ts` (rail landmark, `#801` inset geometry, photo/silhouette at 1440 &
  1920). That is a separate epic, out of scope here (see §6).
- **Consequence we must own:** `SpeciesDetailSurface` is the only place `panel_opened` /
  `panel_dwell_ms` / `panel_scrolled_to_bottom` fire (verified `SpeciesDetailSurface.tsx:73–115`).
  Removing it from the sheet dropped mobile analytics — Task 4 re-wires them natively. Desktop
  analytics (via the rail's surface) are unaffected.

**Scope-split clarification `[R2-fix]` (architecture review).** "Keep the split" applies to the
*page layout shell* (`.sheet-fg` grid, detents, drag, scroll, dismiss). It does **not** require
hand-inlining the photo/silhouette primitive. The reviews are correct that the prototype's
hand-rolled `<img>`/`<div>` photo pair (`SpeciesDetailSheet.tsx:406–414`) is the wrong level of
reuse. **Task 2 composes the existing `<Photo>` primitive (`frontend/src/components/ds/Photo.tsx`)
for the photo slot** — `<Photo>` is one outer `<span className="photo …">`, owns the
null/loading/loaded/errored state machine, threads `src/alt/family/color/pathD/imgUrl/priority/
layout`, renders `<FamilySilhouette>` automatically for the no-photo/errored branch, and emits the
`.photo--silhouette` class the existing e2e already targets. This is the level the split was always
meant to draw the line at: share leaf DS primitives, don't share the page surface. §1.2 below
records why this supersedes rev 1's "inline a parallel DOM tree" wording.

### 1.2 What `<Photo>` composition resolves (and its one real cost)

Composing `<Photo>` (vs. the prototype's hand-inlined `<img>`/`<div>` pair) is the architecturally
correct move and collapses **four** rev-1 problems into one decision:

1. **Silhouette wiring** — `<Photo>` internally builds `<FamilySilhouette>` from
   `family`/`color`/`pathD`/`imgUrl` (`Photo.tsx:109–121`); we just thread the resolvers in (the
   same `resolveColor`/`resolvePath`/`resolveImgUrl` useMemos `SpeciesDetailSurface.tsx:51–71`
   already builds). No hand-rolled silhouette div.
2. **Orphan class** — the prototype's `.sheet-fg-img--silhouette` div (`SpeciesDetailSheet.tsx:410`,
   **no CSS rule** — verified absent in `styles.css`) disappears entirely. `<Photo>` emits
   `.photo--silhouette`, which has real CSS and is already exercised by e2e. The orphan-classname
   gate is satisfied without an allowlist entry.
3. **e2e locator divergence** — the existing `#327 task-12` mobile silhouette assertion targets
   `.photo--silhouette` (`species-detail.spec.ts:345`). With `<Photo>` in the sheet, that locator
   keeps working on mobile **unchanged** — no T1↔T2 disagreement about the silhouette DOM shape.
4. **Decode stability (redesign §4.5 risk 3)** — for a given species, `src` is stable across
   detents, so `<Photo>`'s internal `<img>` (`Photo.tsx:128`) stays mounted and the decoded bitmap
   is preserved; no LCP re-fire on detent change. The photo↔silhouette boundary is a render branch
   *inside one component on a stable outer `<span>`*, and for a fixed species `src` does not flip,
   so the boundary never crosses mid-session. (Honest caveat: `<Photo>` is not literally a single
   leaf node — `<img>` and `<FamilySilhouette>` are alternative children — but the bitmap-stability
   property the redesign actually cares about holds, because `src` is per-species-stable. This is
   strictly better than the prototype, which had the *same* property only by accident and carried
   an orphan-class div on the no-photo branch.)

**The one real cost we must own `[R2-fix]`:** `<Photo>` ships its own aspect-ratio CSS model keyed
on `layout` (`masthead 16/10`, `inline 4/3`, `thumb 1/1` — `Photo.tsx:14–17`), whereas the FG morph
drives an *explicit* width/height/border-radius/margin geometry per `[data-content]` on
`.sheet-fg-photo`. Composing `<Photo>` therefore means the morph CSS targets the **container plus
the Photo's inner nodes**: `.sheet-fg-photo .photo`, `.sheet-fg-photo .photo__img`, and
`.sheet-fg-photo .family-silhouette` must inherit the frame size (width/height: 100%) so the morph
on `.sheet-fg-photo` drives them, and `<Photo>`'s own `aspect-ratio` must be neutralized inside the
sheet (`.sheet-fg-photo .photo { aspect-ratio: auto; }`). Pass `layout="masthead"` for the family
fallback's tint/scale, but the *frame* geometry stays owned by the FG morph, not the Photo layout
token. Task 2's AC gates on this composition working at all three detents.

**Out of scope for desktop:** rail visual changes, modal changes, `SpeciesDetailSurface`
structural changes. The shared body component stays exactly as it is for the rail.

---

## 2. Prototype inventory — proven vs. PROTOTYPE-GRADE

### 2.1 What the prototype already proves (port as-is, harden)

- **Three-detent state machine.** `SnapState = peek|half|full`; `PEEK_PX=104`; half=`0.6·vh`;
  full=`vh−8`. Opens at `half`. `goToSnap`/`settleTo` write `inert` on the **`mainRef.current`
  element** BEFORE the role flip; the collapse-side `useLayoutEffect` removes it AFTER, with the
  unmount-cleanup that fixes the viewport-flip inert leak.
  **`[R2-fix]` inert target is `#map-layer`, not `#main-surface`.** App passes
  `mainRef={mapLayerRef}` (`App.tsx:1478`), so in production the inerted element is `#map-layer`
  (O1 #776). The component is id-agnostic — it inerts whatever `mainRef.current` points at — but
  every *assertion* (unit and e2e) must name the right element (see Task 1 TDD). **This sequencing
  is load-bearing and correct — preserve it verbatim.**
- **Height-driven 1:1 drag** on the handle (`liveHeight` tracks the finger both directions; CSS
  height transition gated off via `[data-dragging='true']`), **velocity flick**
  (`VELOCITY_FLICK_PX_PER_MS=0.5` advances/retracts a detent), **dismiss** (`finalH <
  PEEK_PX·0.6 && vy ≥ 0` → `onClose`), and **drag-vs-tap discrimination** (`didDragRef`
  suppresses the post-drag click; pure tap still cycles). Verified `SpeciesDetailSheet.tsx:240–322`.
- **Field-guide DOM + CSS** — `.sheet-fg` grid re-templates per `[data-content]`; `<dl>` record
  strip + taxonomy table; 3px accent rule; family dot with contrast ring; `<SpeciesDescription>`
  for About. (Photo slot is the one piece we upgrade — see 2.2c.)
- **ESC scoped to focus-inside-sheet.** Preserve (`SpeciesDetailSheet.tsx:208–219`).

### 2.2 PROTOTYPE-GRADE — must be upgraded for production

| # | Prototype shortcut | Production requirement |
|---|---|---|
| **(a)** | **mid→full photo is a positional JUMP.** `.sheet-fg-photo` transitions only `width`/`height`/`border-radius` (`styles.css:1779–1784`), but at full it adds `margin: 0 calc(-1*var(--space-lg))` + explicit `height` while the grid re-templates `120px 1fr` → `1fr` and swaps `grid-template-areas` (`styles.css:1722–1754`). Neither `margin` nor `grid-template-columns` is on the transition list, and **`grid-template-areas` cannot animate at all** — the area-name remap (photo moving from a 2-col cell to a full-width row) is a discrete jump. | Make the mid→full photo read as ONE element growing: add `margin` **and** `grid-template-columns` to the transition consideration; transition the track sizes on `.sheet-fg`. **`[R2-fix]` the `grid-template-areas` remap is NOT animatable** (architecture review correct; redesign §4.5 risk 2 was optimistic). Accept the 1/1→16/10 aspect change as the one real discontinuity (drive explicit height, never animate `aspect-ratio` — verified the prototype already does, `styles.css:1755–1764`). **T1 acceptance now gates on this** (see Task 1 AC + the explicit Safari/iOS live check), or T1 explicitly accepts a stepping un-inset and schedules the recipe-14 cross-fade as a **named** T1 sub-task — it may NOT merge green with a silently-stepping marquee morph. |
| **(b)** | **Content tiers swap via `display:none` gating + a single `fg-reveal` keyframe.** | Implement the planned reveal channels: MID-tier (sci-name + record + teaser) via **texts-reveal (recipe 18)** — opacity/translateY stagger with `.is-shown`/`.is-hiding`; FULL-tier (taxonomy + About) via **panel-reveal (recipe 07)** — translateY(~24px)+opacity+blur on the crossing. The SPINE (name+family) is never `display:none`'d. Use the `transitions-dev` skill (recipes 18 + 07 + 01). Pure CSS, no library. **`[R2-fix]` reduced-motion is asserted, not assumed** (a11y review): every channel's 0ms end-state IS its resting state (add NO per-element guards — `motion.css` owns the collapse), AND T5 adds an explicit AC + test that under `prefers-reduced-motion: reduce` the three reveal channels render at their resting end-state and the velocity-flick settle is instantaneous (diagnosis F14). |
| **(c)** | **Photoless species render a FLAT family-color block** via `<div class="sheet-fg-img sheet-fg-img--silhouette" style="background: famColor">` (`SpeciesDetailSheet.tsx:409–413`). `.sheet-fg-img--silhouette` has **no CSS rule** (orphan className → trips `orphan-classname-check`) and renders no glyph. | **`[R2-fix]` Compose `<Photo>` (see §1.1/§1.2), do NOT hand-roll a silhouette div.** `<Photo>` renders `<FamilySilhouette>` for the no-photo branch and emits `.photo--silhouette`. Thread the real DB shape via `resolveColor`/`resolvePath`/`resolveImgUrl` (the resolvers `SpeciesDetailSurface.tsx:51–71` already builds; **rev 1 wrongly said they were already imported by the sheet — they are NOT;** the sheet imports only `buildFamilyColorResolver`, `SpeciesDetailSheet.tsx:14`). Pass `family={data.familyCode as FamilyCode \| null}` (the family **CODE**, not `familyName` — `<FamilySilhouette>.family` is `FamilyCode \| string \| null`, verified `FamilySilhouette.tsx:33`). Glyph scales with the frame via the §1.2 inner-node sizing rules. |
| **(d)** | **Mobile analytics DROPPED.** `panel_opened` / `panel_dwell_ms` / `panel_scrolled_to_bottom` lived only in `SpeciesDetailSurface`, which the sheet no longer mounts. | Re-wire all three natively in the sheet (Task 4). `panel_opened` on data-arrival; `panel_dwell_ms` on unmount; `panel_scrolled_to_bottom` via an `IntersectionObserver` on a bottom sentinel. **`[R2-fix]` the sentinel must NOT live inside a `display:none` block** (architecture + test-ci): `.sheet-fg-about` and siblings are `display:none` until full (`styles.css:1610–1613`), so a sentinel placed after About would be `display:none` at compact/mid and at full only render once About is in DOM — but a `display:none` element has zero box and never intersects. Place the sentinel as a **direct child of the scroll container `.sheet-fg`, after the About block, with NO tier-gated `display:none`** (it inherits the FG grid but carries its own always-rendered rule, e.g. `height:1px`), so it is in the layout and intersectable at full. Same event names + prop shapes as `SpeciesDetailSurface`. |
| **(e)** | **Live-height 3-state can THRASH at thresholds.** `content` is recomputed every render from single hard boundaries (`SpeciesDetailSheet.tsx:342–344`). A finger hovering a boundary flip-flops → reveals retrigger → flicker (redesign §4.5 risk 4). | Add **hysteresis**: a pure helper `resolveContentTier(height, prevTier, vh)` with a dead-band (±24px), unit-testable in isolation. **`[R2-fix]` fold the helper into T1, not T3** (see §4 + the T1↔T3 coupling fix): T1 introduces `resolveContentTier` from the start so it is not "add an un-hysteresed assertion in T1, then rewrite it in T3." T3 is dropped as a separate task; its content shrinks to nothing once the helper lands in T1. |

### 2.3 Also fix while here (cheap, in-prototype)

- `.sheet-fg-credits` CSS exists (`styles.css:1703–1708`) but is never rendered (credits come from
  `<SpeciesDescription>`). Either render it or delete the rule (knip/orphan hygiene). Decide in T5.
- The legacy `.sheet-compact` / `.sheet-scroll` CSS blocks (`styles.css:1469`, `1487–1524`) and the
  `[data-content='compact'] .sheet-scroll` / `[data-content='full'] .sheet-compact` rules are dead
  once `.sheet-fg` is the only body — remove in T5 to avoid orphan-CSS + knip drift.

---

## 3. Accessibility work to fold in

### 3.1 Already done in the prototype (verify, do not redo)

- **`<dl>` semantics** on the record strip + taxonomy table.
- **Heading order** — species name is `h2#detail-title tabIndex={-1}` (`SpeciesDetailSheet.tsx:420`);
  "About" is `h3` (`.sheet-fg-about-eyebrow`). Page identity keeps the `h1`.
- **Family-dot contrast ring**; family **text** co-located as the canonical signal.
- **"Read account" is a real `<button>`** with `aria-expanded`/`aria-controls="sheet-fg-account"`,
  link color (NOT family accent), persistent underline, `min-height:44px`, down-chevron,
  `:focus-visible` ring.
- **Decorative `alt=""`** on the photo. **`[R2-fix]` with `<Photo>` composition (Task 2):** `<Photo>`
  takes a required `alt` string. For the sheet, pass `alt=""` (decorative — name sits adjacent),
  which `<Photo>` forwards to its `<img alt="">` (`Photo.tsx:130`). The full-bleed masthead is still
  decorative; the photo credit lives in visible text via `<SpeciesDescription>`, not alt.
- **Description sanitize**; **Name focus ring** (`:focus-visible` only).

### 3.2 Must ADD (the three diagnosis findings)

- **F8 — real focus trap at full.** At full the sheet asserts `role=dialog`/`aria-modal` but only
  inerts `#map-layer`; Tab escapes into the still-tabbable AppHeader. **Mirror the filters-panel
  Tab-wrap** in `App.tsx:247–315` (collect focusables with the same selector
  `a[href], button:not([disabled]), input…, [tabindex]:not([tabindex="-1"])`; on `Tab`/`Shift+Tab`
  wrap first↔last). Active **only at full** (`snap==='full'`), torn down when leaving full or
  unmounting. Keep it inside `SpeciesDetailSheet` (the handle is the first focusable). Install the
  Tab handler WITHOUT touching `inert`/`role` timing so the MutationObserver sequencing tests stay
  green. Delete the stale `styles.css:1414–1421` comment claiming chrome is "non-interactive" — true
  for pointer, false for Tab.
- **F9 — focus restore on close. `[R2-fix]` resolve the fallback selector to a REAL rendered id.**
  The sheet has no `previouslyFocusedRef`. Mirror `SpeciesDetailModal.tsx:55–167` /
  `SpeciesDetailRail.tsx:52–76`: capture `document.activeElement` on mount; on `onClose`, restore to
  it if `document.contains(previous)`, else fall back to a **real, focusable landmark**.
  **The Rail/Modal default `#surface-tab-map` is a DEAD selector — it is never rendered anywhere in
  `frontend/src`** (verified by grep; the only rendered ids are `id="main-surface"` and
  `id="map-layer"`, `App.tsx:1361`/`1289`). So the Rail's `fallback?.focus()` is a silent no-op
  today (the Rail is invoked without a `fallbackFocusSelector` prop, `App.tsx:1460–1465`). **Do NOT
  inherit `#surface-tab-map`.** Use **`#main-surface`** as the sheet's fallback: it is rendered
  (`App.tsx:1361`) and **focusable** (`<main tabIndex={0}>`, `App.tsx:1380`). (`#map-layer` exists
  but is not inherently focusable, so it is the wrong restore target.) Restore must fire on the
  dismiss path (drag-down + ESC-at-peek) too, not just a button close. **Add a unit assertion that
  `document.querySelector('#main-surface') !== null` so the no-op can never silently ship.**
- **F10 — announce on reaching a readable detent. `[R2-fix]` live region lives INSIDE the sheet,
  de-conflicted with the existing full-snap focus effect.** Today heading focus fires only at full
  (`SpeciesDetailSheet.tsx:328–335`, early-returns when `snap!=='full'`). At **half** the identity
  becomes legible but nothing is announced. Add a polite live announcement (a visually-hidden
  `aria-live="polite"` region rendered **as a descendant of the sheet root**, so it is inside the
  `aria-modal` subtree and still announced at full — an *external* live region like the app-root
  `role="status"` at `App.tsx:1389`, which is a sibling of `#map-layer`, can be ignored by AT once
  the sheet asserts `aria-modal="true"`). De-confliction rules:
  - **Single announce per readable detent.** Fire the half-announce only on the *first* transition
    into `half` from `peek`; do not re-fire on `full→half`.
  - **No double-fire with the full focus-move.** The existing effect already moves focus to
    `#detail-title` at full; on a fast flick `half→full`, the half live-region update and the full
    focus-move must not stutter. Choose the **live-region** option (NOT the "move focus to
    `#detail-title` at half" option), because moving focus to the same heading at both half and full
    would announce it twice. Debounce/guard so a flick straight through half to full produces at most
    one half announcement (or suppress the half announce entirely if `full` is reached within the
    same gesture). Do not steal map focus at `peek`.
  - Add a unit test for single-announce-per-readable-detent.

### 3.3 Remaining tuning-punch-list items (NOT yet applied — fold in)

Most HIGH items are done (§3.1). Remaining, by detent:

- **ALL:** photoless silhouette glyph (= 2.2c, via `<Photo>`). Audit the **full** family palette vs
  `#fff` and the navy surface at 3:1 for the dot ring (spot-check, not just cardinal-red).
- **COMPACT:** thumb radius → `--card-radius-inner` (8px); vertically center the text block to the
  thumb (`align-items:center`). 2px between name and family; family at `--color-text-muted`.
- **MID:** plate→text gap `--space-md`; name `--type-lg` (done) + vertically center stack against
  the plate (`align-self:center` done — verify); sci-name `margin-top:2px`; de-double the accent
  rule vs the record-strip border; tighten record-strip density; `<dl>` semantics (done); 44×44 hit
  area on Read-account (done). Confirm record-strip label contrast ≥4.5:1 at 11px in BOTH themes.
- **FULL:** taxonomy row alignment (verify uniform row heights & top-align); masthead bottom-edge
  gradient scrim + `object-position:center 35%` (object-position done; **scrim not done** — add
  transparent→~12% black over lower ~64px); About eyebrow rhythm; credit on its own line at a
  confirmed-AA token; **alt text** — keep decorative `alt=""` and ensure photo credit is in visible
  text, not alt.

---

## 4. Task decomposition (1-PR-sized, CI-green each)

The work does **not** cleanly split into "motion PR then layout PR" — motion without the mid
redesign still reads as a clipped full view (redesign §4.5 risk 8), and the layout already exists
in the prototype. We split by **risk surface + test surface** so each PR is independently
green-able.

> **`[R2-fix]` Task count change.** Rev 1 had 5 tasks (T3 = hysteresis). The reviews showed
> T1↔T3 had a test-coupling conflict (T1 added an un-hysteresed boundary assertion that T3 would
> then rewrite — the exact "leave a test then rewrite it next PR" anti-pattern §4's own rule
> forbids). **Resolution: fold the `resolveContentTier` hysteresis helper into T1.** The plan is now
> **4 implementation tasks** (T1, T2-silhouette, T3-analytics, T4-a11y) + the epic. 4 > 2 ⇒ epic.

### Epic

> **Epic: Production field-guide mobile species sheet (off-prototype).** Tracks T1–T4. Links
> `mid-full-redesign.md`, `diagnosis-report.md`, `fg-tuning-punchlist.md`, this plan. Child PRs
> land in order; the epic closes after T4 + final 5-viewport × 2-theme design review.

### Dependency order

```
T1 (port shell + hysteresis helper + tests rebaseline) ──┬── T2 (Photo-composed silhouette glyph) ──┐
                                                          └── T3 (analytics rewire) ───────────────┴── T4 (a11y F8/F9/F10 + tuning + cleanup)
                                                          (motion polish + reveal recipes folded into T1)
```

T1 is the foundation (it makes the FG sheet the production component, introduces the hysteresis
helper, and rebaselines the broken tests). T2/T3 are independent after T1 and may run in parallel
worktrees. T4 is last because the focus trap interacts with the final DOM and the tuning pass wants
the silhouette + analytics already present.

> **`[R2-fix]` Same-file collision warning (test-ci review).** T2, T3, **and** T4 all edit
> `SpeciesDetailSheet.tsx` **and** `SpeciesDetailSheet.test.tsx`. They ship serial per the
> multi-PR batch rule (`multi_pr_serial_ship`), but each rebase after a merge is a **guaranteed
> manual conflict** in those two files, not a clean replay. The implementer must expect to resolve
> the component + test-file conflict by hand AND re-run the full unit suite locally on each rebase
> (a bot re-dispatch alone is insufficient — branch-protection dismisses the stale APPROVE on
> rebase, so re-dispatch the bot *after* the manual rebase + local-green confirmation).

> **CI-coupling rule (memory: plan_ci_coupling).** Each task below leaves
> `test`/`lint`/`build`/`e2e`/`knip`/`orphan-classname-check` GREEN. No "leave a check red, fix
> next PR." Where a test's *assertion* must change because the behavior intentionally changed, the
> rewrite lands **in the same PR** as the behavior change (T1).

---

#### Task 1 — Port the field-guide sheet to production + hysteresis helper + rebaseline the broken specs

**Why first / why one PR:** the behavior changes (open-at-half, drag, FG layout, hysteresis) and the
test rewrites those changes force are inseparable — splitting them strands CI red.

**Files touched:**
- `frontend/src/components/SpeciesDetailSheet.tsx` — port the prototype minus the PROTOTYPE-grade
  shortcuts T2/T3 own; remove the `PROTOTYPE`/`Strategy 1` comment scaffolding; keep the inert↔role
  sequencing comments. **Add `resolveContentTier(height, prevTier, vh)`** (pure, exported) and drive
  `[data-content]` through it (replaces the inline single-boundary expression at lines 342–344).
- `frontend/src/styles.css` — port `.sheet-fg-*`; replace `@keyframes fg-reveal` with the **recipe 18
  (texts-reveal) + recipe 07 (panel-reveal)** channels (use `transitions-dev`); add `margin` AND
  `grid-template-columns` to the morph transition consideration (2.2a). **`[R2-fix]` the
  `.sheet-fg-img--silhouette` orphan class is resolved IN THIS PR, not deferred:** since T1 ports the
  shell but T2 does the `<Photo>` swap, T1 must NOT port the orphan `<div className="sheet-fg-img
  sheet-fg-img--silhouette">` verbatim. **Pick ONE explicitly: (a)** pull the `<Photo>` swap forward
  into T1 (preferred — removes the orphan at the source and there's no interim orphan to allowlist),
  OR **(b)** if T1 must keep the no-photo branch as a placeholder, give `.sheet-fg-img--silhouette` a
  real CSS rule for the duration. Do NOT ship T1 with an unrules orphan class on the promise T2 will
  fix it — `orphan-classname-check` gates Mergify and would block the whole queue. **Recommended: do
  (a)** — fold the `<Photo>` composition into T1 and drop T2's component change to a pure
  tuning/audit pass. (If kept separate, T1 takes path (b) and T2 deletes the placeholder + rule.)
  Do NOT yet delete the legacy `.sheet-compact`/`.sheet-scroll` rules (T4).
- `frontend/src/components/SpeciesDetailSheet.test.tsx` — rewrite (see below).
- `frontend/e2e/sheet-snap.spec.ts` — rewrite open-at-* expectations + add drag e2e (see below).
- `frontend/e2e/species-detail.spec.ts` — fix the **mobile** variants (see below).

**Acceptance criteria:**
- Sheet opens at `half`, role `region`; advancing reaches `full` with `role=dialog`+`aria-modal`
  and the `mainRef` element (`#map-layer` in App) inert; collapse reverses. Drag up grows 1:1; drag
  down past dismiss closes; velocity flick advances/retracts. `[data-content]` = compact|mid|full
  driven by `resolveContentTier` (hysteresed).
- **`[R2-fix]` mid→full morph reads as a continuous element on Safari/iOS** (drive live during T1).
  EITHER this passes and is part of the AC, OR T1 explicitly documents acceptance of a stepping
  un-inset and lands the recipe-14 cross-fade as a named sub-task in the same PR. T1 may NOT merge
  with a silently-stepping morph.
- `npm run -w @bird-watch/frontend test`, `lint`, `build`, and `e2e` all green.
- Zero console errors/warnings at all 5 canonical viewports × 2 themes (live Playwright drive).
- `orphan-classname-check` and `knip` clean (no orphan `.sheet-fg-img--silhouette`; add ignore rules
  with dated comments only for true FPs).

**TDD strategy (unit — `SpeciesDetailSheet.test.tsx`):**

> **`[R2-fix]` Inert-target wording (test-ci review).** The existing unit suite creates a synthetic
> `mainEl` (`SpeciesDetailSheet.test.tsx:38–39`, `id="main-surface"`) and passes it as `mainRef`.
> The component is id-agnostic, so these tests are valid as written — they assert inert on the
> element the test passed. Do NOT loosely say "#main/map not inert." Be target-specific: **unit
> tests assert inert on the passed `mainRef.current` element** (the fixture's `mainEl`); **e2e tests
> assert inert on `#map-layer`** (`app.mapLayer`, the real production target per `App.tsx:1478`).

*Assertions that BREAK and MUST be rewritten:*
- **`opens at peek snap …` (lines 46–61)** → assert **opens at `half`**, `role=region`,
  `aria-label="Selected sighting"`, no `aria-modal`, `mainRef` element NOT inert.
- **`expand button advances peek → half → full` (63–86)** → now **half → full** (two detents from
  open, not three). Re-derive the click count.
- **The implicit tap-cycle behavior:** keep one explicit test that a pure tap on the handle still
  expands/collapses (Material-3 fallback), but assert it does NOT double-advance after a drag
  (`didDragRef` suppression).

*Assertions that MUST STAY GREEN (do not weaken):*
- **`inert is set BEFORE the role flips` (88–128)** — the MutationObserver sequencing test.
- **`collapse path … removes inert AFTER role flips back` (130–152)**.
- **`unmounting at full snap cleans up inert` (205–230)** — viewport-flip regression.
- **`ESC scoped …` (154–181)** and **`drag-down past peek dismisses` (183–203)** — adjust for
  open-at-half.

*New unit specs to add (this PR):*
- open-at-`half` initial detent; `[data-content]` resolves to `mid` at the half height.
- 1:1 drag: a `pointermove` of Δy=−120 from `half` sets `liveHeight ≈ heightFor(half)+120`.
- velocity-snap: a fast up-flick (`vy < −0.5`) from `half` settles to `full`; fast down-flick to
  `peek`.
- **`resolveContentTier` hysteresis (folded in from former T3):** table-driven — ascending heights
  cross compact→mid→full at the up-thresholds; descending heights hold each tier until the lower
  edge of the ±24px dead-band; a height oscillating inside the band keeps `prevTier`. **This replaces
  rev 1's "assert the un-hysteresed boundary" spec** so there is nothing for a later task to rewrite.

**TDD strategy (e2e):**
- **`sheet-snap.spec.ts`** — rewrite `opens at peek` → `opens at half`; keep the role-flip,
  `#map-layer` inert (`app.mapLayer`), z-tier probe, collapse, and drag-down-dismiss assertions. Run
  at 390×844.
- **`[R2-fix]` ADD a concrete drag-UP / flick e2e** (test-ci review — drag-up/flick currently has
  ZERO e2e, only synthetic-PointerEvent unit coverage; the brief lists drag as required e2e):
  drag the handle up from `half` and assert sheet `height` grows ~1:1 with the drag distance; then a
  fast upward flick from `half` settles `data-snap-state='full'`. Use Playwright pointer
  (`mouse.move`/`mouse.down`/`mouse.up` with intermediate steps) so velocity is real.
- **`species-detail.spec.ts` mobile breakage (the brief's hidden landmine):** line 30 asserts
  `.species-detail-family` and the `#327 task-12` block asserts the silhouette at **both 1440 AND
  390** (loop `species-detail.spec.ts:288–349`). The FG sheet renders `.sheet-fg-family` (not
  `.species-detail-family`). **`[R2-fix]` with `<Photo>` composition the mobile silhouette locator
  STAYS `.photo--silhouette`** (Photo emits it, `Photo.tsx:104`) — do NOT point it at
  `.sheet-fg-img--silhouette` (rev 1 was wrong; that class is being deleted). **Fix:** scope the
  family-name locator per-surface — desktop (rail) keeps `.species-detail-family`; the mobile (sheet)
  variant asserts `.sheet-fg-family`. The mobile photo is decorative (`alt=""`), so the mobile
  `getByAltText('… photo')` assertion must change to the FG decorative-photo expectation. The
  silhouette assertion (`.photo--silhouette`) works on both surfaces unchanged. Do this in T1 so e2e
  is green the moment the sheet swaps.

---

#### Task 2 — `<Photo>`-composed family silhouette glyph (2.2c + punch-list)

> **`[R2-fix]` If T1 took path (a)** (folded the `<Photo>` swap forward), this task shrinks to the
> silhouette **tuning/audit** items only (palette contrast, dot-ring spot-check, per-theme tint) and
> the no-photo e2e assertion verification. The component swap below describes path (b) where T1 kept
> the placeholder.

**Files:** `SpeciesDetailSheet.tsx` (replace the hand-rolled photo pair with `<Photo>` threaded with
`src`/`alt=""`/`family={data.familyCode as FamilyCode|null}`/`color`/`pathD`/`imgUrl`/
`priority`/`layout="masthead"`; **add the missing imports** `buildFamilyPathResolver` +
`buildFamilyImgUrlResolver` from `../data/family-color.js` and the `resolvePath`/`resolveImgUrl`
useMemos mirroring `SpeciesDetailSurface.tsx:51–71`), `styles.css` (the §1.2 inner-node sizing rules:
`.sheet-fg-photo .photo { aspect-ratio:auto; width:100%; height:100% }`, `.sheet-fg-photo .photo__img`
+ `.sheet-fg-photo .family-silhouette` inherit the frame; **delete** the orphan
`.sheet-fg-img--silhouette` placeholder + any rule path (b) added).

**Correct file path `[R2-fix]`:** `frontend/src/components/ds/FamilySilhouette.tsx` and
`frontend/src/components/ds/Photo.tsx` (rev 1 wrote `ds/FamilySilhouette.tsx` — implementers must use
the full path; ignore the `.claude/worktrees/` copies). **Before writing the failing test, read
`Photo.tsx`, `FamilySilhouette.tsx`, and `FamilySilhouette.test.tsx`** to confirm the prop surface.

**AC:** a no-photo species renders the family glyph (via `<Photo>`→`<FamilySilhouette>`) centered on
the family-color ground at 44/120/masthead, per-theme contrast; the morph still works (glyph scales
with the frame via §1.2 sizing); decode-stability holds (the `<img>` does not remount across detents
for a fixed species); dot-ring palette audit ≥3:1; `orphan-classname-check` clean (no
`.sheet-fg-img--silhouette`).

**TDD:** unit — no-photo fixture (`VERMFLY`) renders `<FamilySilhouette>` (`data-testid=
"family-silhouette"` present, via `.photo--silhouette` wrapper) at each `[data-content]`; with-photo
fixture renders the `<img>` (`.photo--silhouette` absent). e2e — the `#327 task-12` mobile silhouette
assertion (`.photo--silhouette`) already passes after T1; verify it stays green; 5-viewport × 2-theme
console-clean.

---

#### Task 3 — Re-wire mobile analytics (2.2d)

**Files:** `SpeciesDetailSheet.tsx` (import `analytics`; `panel_opened` on data-arrival,
`panel_dwell_ms` on unmount via effect-cleanup, `panel_scrolled_to_bottom` via
`IntersectionObserver` on a bottom sentinel). Optional: a tiny `use-detail-analytics.ts` hook sharing
the shape with `SpeciesDetailSurface`'s logic (do not import the surface).

**`[R2-fix]` Sentinel placement (architecture + test-ci):** render the sentinel as a **direct child
of `.sheet-fg` after the About block, with NO tier-gated `display:none`** (it must NOT sit inside
`.sheet-fg-about`/`.sheet-fg-taxonomy`/etc., which are `display:none` until full —
`styles.css:1610–1613` — and a `display:none` element never intersects). The `IntersectionObserver`
roots on the nearest scroll ancestor (`.sheet-fg`, the scroll container only at full — compact/mid
don't scroll), so the sentinel only meaningfully intersects at full, which is the intended semantic.

**AC:** same event names + prop shapes (`species_code`, `has_description`, `dwell_ms`) as
`SpeciesDetailSurface` (verified `SpeciesDetailSurface.tsx:78–115`); `panel_scrolled_to_bottom` fires
once when About scrolls into view at full; no double-fire across detent changes.

**TDD:** unit — mock `analytics.capture`; assert `panel_opened` fires once on data resolve,
`panel_dwell_ms` on unmount, sentinel-intersection fires `panel_scrolled_to_bottom` once
(IntersectionObserver mocked, mirroring `SpeciesDetailSurface.test.tsx`). **`[R2-fix]` ADD a real
e2e** (test-ci — `panel_scrolled_to_bottom` depends on a live IntersectionObserver that unit tests
mock away, and analytics were silently dropped once before): at 390×844, open to full, scroll
`.sheet-fg` to the bottom, and assert the PostHog capture via a route-intercept or a `window` spy on
`analytics.capture` for `panel_scrolled_to_bottom`.

---

#### Task 4 — A11y F8/F9/F10 + remaining tuning + dead-code cleanup

**Files:** `SpeciesDetailSheet.tsx` (focus trap at full; `previouslyFocusedRef` + restore on every
close path with the **`#main-surface`** fallback; in-sheet live-region announce), `styles.css`
(masthead scrim, compact/mid/full tuning deltas, delete legacy `.sheet-compact`/`.sheet-scroll` +
unused `.sheet-fg-credits`, fix the stale `1414–1421` comment). **No `App.tsx` change needed for the
fallback** — `#main-surface` already exists and is focusable (`App.tsx:1361`/`1380`), so the sheet
just targets it; do NOT add a new landmark.

**AC:** at full, Tab/Shift+Tab cycle within the sheet (cannot reach AppHeader); ESC + drag-dismiss
restore focus to the trigger-or-`#main-surface`; reaching `half` announces once to AT via the
in-sheet live region; reduced-motion collapses all reveal channels to resting end-state (F14);
punch-list tuning items applied; `axe.spec.ts` clean at all 5 viewports × 2 themes;
`knip`/`orphan-classname-check` clean.

**TDD (unit — the focus-trap spec is the headline):**
- **focus-trap:** at full, programmatically focus the last focusable, dispatch `Tab` → focus wraps
  to the first; `Shift+Tab` from the first → last; at peek/half the trap is NOT installed.
- **focus-restore:** render with a known `activeElement`; close via button, via ESC, and via
  drag-dismiss → focus returns to it (and to `#main-surface` when the trigger is detached, guarded by
  `document.contains`). **Assert `document.querySelector('#main-surface') !== null`** so the fallback
  can never be a silent no-op (the dead `#surface-tab-map` lesson).
- **announce:** transitioning peek→half fires the in-sheet live region exactly once; a flick
  peek→full does not double-announce; peek does not steal map focus.
- **reduced-motion:** under `prefers-reduced-motion: reduce` the reveal channels render at their
  resting end-state.
- **Keep green:** all the inert↔role sequencing tests (the trap must not perturb the MutationObserver
  order — install the Tab handler without touching `inert`/`role` timing).
- **e2e — `[R2-fix]` concrete focus-trap assertion** (test-ci — F8 is the headline a11y fix and must
  be falsifiable, not just covered by axe): at full (390×844), focus the last focusable inside the
  sheet → press `Tab` → assert focus is back inside the sheet (the handle/first focusable) and that
  an AppHeader control (e.g. the Filters trigger) is **NOT** the active element; `Shift+Tab` from the
  first focusable → focus lands on the last inside the sheet. Plus `axe.spec.ts` clean, 5 viewports ×
  2 themes.

---

## 5. Risks + migration

- **Migration off `proto/mobile-sheet-strategy-2`.** Do NOT branch production work off the proto
  branch. Each task branches off `main`. T1 ports the proto file content into a clean `main`-based
  branch; the proto branch is then abandoned (its uncommitted state is the reference, not the
  ancestor). Confirm `main` has not drifted the sheet/CSS since the proto snapshot before porting
  (note: this revision was verified against the proto branch; re-diff against `main` first).
- **Multi-PR serial-ship discipline + same-file collisions** (memory: multi_pr_serial_ship). T2/T3
  implement in parallel worktrees but **ship serial**. Per the §4 `[R2-fix]` warning, T2/T3/T4 all
  touch `SpeciesDetailSheet.tsx` + `.test.tsx`, so each rebase is a **manual conflict** — resolve by
  hand, re-run the full unit suite locally, THEN re-dispatch the bot (branch-protection dismisses the
  stale APPROVE on rebase). Mergify `batch_size:1`.
- **Mid→full photo morph on Safari/iOS** (redesign §4.5 risks 1–3). The 1/1→16/10 aspect change +
  margin un-inset + the **non-animatable `grid-template-areas` remap** is the trickiest transition;
  `aspect-ratio` must not be animated. T1's AC now gates on this reading as continuous on Safari, or
  on an explicit documented acceptance of stepping + the recipe-14 cross-fade landed in T1.
- **`overflow-x` during the un-inset** (risk 5) — keep `overflow-x: clip` on `.sheet-fg` and the
  sheet root so the morphing photo never spawns a horizontal scrollbar (the `mobile-bundle-e.spec`
  asserts `body.scrollWidth ≤ 390`).
- **Reveal timing trailing the settle on a fast flick** (risk 7) — acceptable; shorten reveal
  durations toward the 300ms settle if it reads as lag. Verify the feel live.
- **`knip` + `orphan-classname-check` gate Mergify** (CLAUDE.md) — both block the queue even when
  "informational." `.sheet-fg-img--silhouette` is resolved in T1 (no interim orphan). Removing
  `.sheet-compact`/`.sheet-scroll`/`.sheet-fg-credits` (T4) must not leave a JSX className without a
  CSS rule or vice-versa; run both checks per PR before `@Mergifyio queue`.
- **PR workflow** — `.github/PULL_REQUEST_TEMPLATE.md` verbatim (5 sections, Screenshots REQUIRED on
  `frontend/**` — ≥10 `user-attachments` URLs, 5 viewports × 2 themes, via the
  `pr-screenshots-via-user-attachments` skill, never committed PNGs); design-review subagent
  (`ui-design:ui-designer`, `model: opus`) must PASS all 5 viewports before bot review; bot review
  via the `julianken-bot` Agent; never `gh pr merge`.

---

## 6. Out of scope / follow-ups

- **Desktop rail/modal field-guide adoption.** Separate epic: redesign `SpeciesDetailSurface`,
  re-baseline its 25KB unit suite + the desktop half of `species-detail.spec.ts`, reconcile with the
  four-corner anchor contract.
- **Fix the dead `#surface-tab-map` default in the Rail/Modal.** `[R2-fix]` This revision discovered
  that `SpeciesDetailRail`/`SpeciesDetailModal` default `fallbackFocusSelector` to `#surface-tab-map`,
  which is **never rendered** — so their detached-trigger focus restore is a silent no-op today. The
  sheet avoids it (uses `#main-surface`), but the Rail/Modal bug is real and should be filed
  separately (pass a real selector or change the default to `#main-surface`). Not in this epic's
  critical path, but it is a latent a11y regression worth a tracking issue.
- **Map recenter / bottom-inset on snap change** so the tapped marker stays visible above the sheet
  (diagnosis open-Q 2). Defer.
- **Deck/standfirst "first sentence pulled out"** (Editorial-only) — not in the locked Field-guide
  direction; skip.
- **Runtime DOMPurify defense-in-depth** for descriptions — already deferred to v2 (epic #368).
- **`SpeciesDetailModal.tsx` / `lib/use-is-mobile.ts` dead WIP** (diagnosis §5) — untracked,
  unimported; clean up opportunistically, not in this epic's critical path.
- **Delete the proto branch** `proto/mobile-sheet-strategy-2` after T1 merges.

---

## 7. Decision — RESOLVED (Julian, 2026-06-06): Option A

**T1↔T2 boundary (the `<Photo>` swap timing) — RESOLVED to Option A.** The `<Photo>` composition is
folded into **T1** (no interim orphan class, no allowlist churn; the silhouette / decode-stability /
e2e-locator fixes all land in T1). **T2 shrinks to a pure silhouette tuning/audit pass** (family
palette ≥3:1 spot-check, per-theme tint, no-photo e2e verification). The original framing is retained
below for the record.

**T1↔T2 boundary (the `<Photo>` swap timing).** The orphan-class fix forces a choice the plan can
frame but not unilaterally settle without your steer:

- **Option A (recommended):** fold the `<Photo>` composition into **T1**. Pro: no interim orphan
  class, no allowlist churn, the silhouette/decode-stability/e2e-locator fixes all land together, and
  T2 shrinks to a pure tuning/audit pass. Con: T1 grows larger (it already carries the shell port +
  hysteresis + test rebaseline).
- **Option B:** keep T1 as the shell port and give `.sheet-fg-img--silhouette` a temporary real CSS
  rule, then do the `<Photo>` swap + delete in T2. Pro: smaller T1. Con: ships a throwaway CSS rule
  for one PR's lifetime; the swap-and-delete is pure churn.

Everything else from the three reviews is folded in deterministically; this is the only place where
the right call depends on your appetite for T1 size vs. interim churn.
