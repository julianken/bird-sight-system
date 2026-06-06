# Mobile Species-Detail Bottom Sheet — Diagnosis & Decision Report

Scope: the live compact (≤1199px) species detail surface, `SpeciesDetailSheet`. Three lenses (code, ux, options) plus three adversarial critiques. Where a critique refuted or downgraded a claim, this report defers to the critique.

---

## 1. TL;DR

- **It opens unreadable.** The sheet opens at a 120px peek; the body's first element is a full-bleed 16:10 hero photo (~244px tall at 390px wide) that alone is 2× the peek height, so the species name, scientific name, family, and description are all clipped below an `overflow:hidden` fold. The user sees a grab handle and a sliver of photo. (F2 — confirmed)
- **Drag up is dead.** `translate = Math.max(0, dragOffset)` pins all upward motion to 0px (the sheet never follows the finger up), and the snap threshold additionally requires a single >193px pull to advance peek→half — so a normal upward drag produces no movement, no snap, no feedback. (F4 — confirmed)
- **The one direction that moves, lags.** Down-drag tracks the finger, but `transition: transform 200ms ease` is live during the drag, so each frame eases toward the target instead of sticking 1:1. There is also no velocity/flick detection (displacement-only thresholds). (F5, F6 — confirmed)
- **So tapping the bar is the only thing that "works."** The handle stacks `onClick` (tap cycles peek→half→full) on top of the half-built drag handlers. Because drag is broken, tap is the only reliable detent change — exactly the user's "it just changes states when I click the bar." This is an inverted affordance: native handles are drag targets. (F3 — confirmed)
- **Three a11y defects the original diagnosis missed.** At full the sheet claims `role=dialog`/`aria-modal` but installs no focus trap and only inerts the map subtree, so Tab escapes into the still-interactive AppHeader (F8); there is no focus restoration on close (F9); heading focus fires only at full, so expanding to the readable half state announces nothing to assistive tech (F10).
- **Fix direction:** open at a content-legible detent (recommended: the existing `half`), make the active drag track the finger 1:1 (gate the CSS transition off during drag), add velocity/flick snapping, and either add a real focus trap at full or stop asserting `aria-modal`. The recommended path is to fix the hand-rolled sheet in place — no library — because every library candidate breaks the per-snap non-modal contract and forces a full test rewrite.

---

## 2. Root-cause findings (CONFIRMED after critique)

All findings below survived adversarial fact-checking. Citation corrections from the critique are folded in (noted inline). F11 is included because it *refutes* a feared bug, which is decision-relevant.

| Finding | Severity | Evidence | Maps to user complaint |
|---|---|---|---|
| **F2 — Opens at peek=120px; identity content clipped below the fold** | HIGH (BLOCKER per ux) | `SpeciesDetailSheet.tsx:79` `useState('peek')`, `:21` `PEEK_PX=120`, `:111-112`; first body element is `<Photo layout='masthead'>` (`SpeciesDetailSurface.tsx:143-152`); masthead aspect-ratio is `.photo--masthead{aspect-ratio:16/10}` at **`ds-primitives.css:282-283`** (critique correction: the lens mis-cited `Photo.tsx:15`, a JSDoc comment; `.species-detail-photo` at `styles.css:680-695` is a stale/unused class); peek clip via `.species-detail-sheet--peek{overflow:hidden}` `styles.css:1555` | "opens stuck to the bottom, not in a readable state" |
| **F4 — Drag UP is dead (clamp + 50%-of-386px threshold)** | HIGH | `SpeciesDetailSheet.tsx:274` `translate=Math.max(0,dragOffset)`; `dragOffset=e.clientY-start.y` `:214` (negative when dragging up → clamped to 0); up-branch advances only if `-delta > span*0.5` where span = 506−120 = 386 → 193px (`:240-246,25,31`) | "drag doesn't work" (expand direction) |
| **F5 — Down-drag lags (transition live during drag)** | MEDIUM | inline `transform:translateY` `:287`; `.species-detail-sheet{transition: height 200ms ease, transform 200ms ease}` `styles.css:1399-1400`; never disabled during drag; reduced-motion users get 1:1 only incidentally via `motion.css:20-27` | "drag is laggy/janky" (retract direction) |
| **F6 — No velocity/flick; rigid slide, not resize** | MEDIUM | `dragStartRef={y,snap}` with no timestamp `:205`; displacement-only thresholds (`DISMISS_THRESHOLD_PX=80` `:229`, `SNAP_TRANSITION_RATIO=0.5` `:246/253`); height fixed during drag (`:273`), only transform moves | reinforces "drag feels broken / not native" |
| **F3 — Handle stacks tap-cycle + drag; no drag-vs-tap discrimination** | MEDIUM | `:296` `onClick={isFull?collapse:expand}` AND `:297-300` `onPointer*` on the same `<button>`; latent double-advance (browsers usually suppress click after pointer-capture+move, so this is latent, not guaranteed live) | "3 states when you click the bar" |
| **F8 — Full snap asserts `aria-modal` but has NO focus trap** | HIGH | `:282-284` set role/aria-modal; inert written only on `#map-layer` (`:162-164`, `App.tsx:1474`); `App.tsx:264-268` documents AppHeader stays tabbable, which is why the filters panel adds an explicit Tab-wrap (`App.tsx:269-293`); sheet adds none. Bonus drift: `styles.css:1415-1421` comment claims chrome is "non-interactive while the modal sheet is open" — false for keyboard Tab | (missed by orchestrator; broken aria-modal contract) |
| **F9 — No focus restoration on close/unmount** | MEDIUM | sheet has no `previouslyFocusedRef`; `onClose`→`App.tsx:1468-1473`/`1117-1120` only clears detail; contrast `SpeciesDetailModal.tsx:129-140` which restores to trigger with `document.contains` guard | (missed; keyboard regression vs desktop) |
| **F10 — Heading focus fires only at full** | MEDIUM | `:263-264` `if (snap!=='full') return;` gates the `#detail-title` focus. Critique nuance: at peek/half content is **not** inerted and `.sheet-scroll` is `tabIndex=0` (`:310`), so content is reachable manually — only auto-announcement is missing | (adjacent to "opens not in a readable state") |
| **F11 — Feared scroll-vs-drag interception is REFUTED** | LOW | drag bound only to `.sheet-handle` (`:297-300`), not `.sheet-scroll`; `.sheet-handle{touch-action:none}` `:1427`, `.sheet-scroll{touch-action:pan-y}` `:1457` → no conflict. Real (minor) gap: cannot drag from the content body | (rules out a hypothesized cause) |
| **F13 — PEEK_PX/CSS desync hazard** | LOW | `PEEK_PX=120` `:21`; hand-synced `+120px` legend offset `styles.css:1142-1145` ("MUST stay synced to PEEK_PX"); **exactly one** stale "96px" comment at `styles.css:1553` (critique correction: the lens claimed two — the other "96px" hits at `SpeciesDetailSheet.tsx:17` and `styles.css:677` are an accurate history note and an unrelated silhouette-glyph size) | (latent maintenance hazard) |
| **F15 — onSnapChange→legend reset only via onClose** | PARTIAL | `:85-87` fires onSnapChange; `App.tsx:216-221` derives `legendForceCollapsed` gated on `isPhone` (≤480px); reset lives in onClose (`App.tsx:1471`). Benign today because the viewport-flip to rail is ≥1200px (different breakpoint), but reset-on-close-only is fragile | (none) |

Confirmed-but-low-relevance findings F1 (component routing: sheet ≤1199px, rail ≥1200px — exact), F7 (dead WIP files — see §5), F12 (test guidance — see §4/§5), and F14 (reduced-motion is global and does not mask the JS-logic drag flaws) are all TRUE and back the analysis but are not user-facing defects.

---

## 3. The native target

Every native reference (Apple Maps / Google Maps place sheets, iOS `UISheetPresentationController`, Material 3 bottom sheet) shares a single invariant the current sheet violates:

- **Open at the smallest detent where core identity is *legible*, never a content-clipping sliver.** *(Critique correction to the ux lens: it is overstated to say native always opens at a "medium ~40-55%" detent — Apple Maps actually opens its place sheet at a small/collapsed detent showing name + subtitle + one action row, a few hundred px, and `selectedDetentIdentifier` is nil-until-interaction. The correct, defensible rule is "legible identity, not clipped," not "medium is the native default.")*
- **1:1, zero-latency finger tracking in both directions during the drag**; transitions/springs animate only the settle *after* release. Up and down symmetric.
- **Velocity-aware snapping** — a fast flick advances to the next detent even on tiny travel; slow drags use a displacement threshold against the projected terminal position.
- **Non-modal at partial detents** — no scrim, map stays pannable/zoomable/tappable behind the sheet; modality (and any dim) appears only at the largest detent. This is the defining property of a map place-sheet.
- **Drag is the primary handle gesture.** *(Critique correction: tap-to-cycle is NOT non-native in general — Material 3's `BottomSheetDragHandleView` documents click-to-cycle as the single-pointer/a11y alternative. It is undocumented only on iOS. The valid conclusion survives: drag must be the working primary path; tap-only is the bug.)*
- Settle motion is a velocity-seeded spring; under `prefers-reduced-motion`, a near-instant non-springy move.

**Recommended default detent: `half`** (the existing `HALF_FRACTION=0.6` → 506px @ 844vh; math verified). It is the smallest existing detent at which name + sci-name + family + lede render without a gesture, it keeps the map visible above the sheet (non-modal), and it gives a natural two-way affordance (flick up to full for the long description, down to peek/dismiss).

**Two map-specific risks the ux lens did not resolve (flagged here, not yet answered):**
1. A 506px sheet leaves only ~338px of map above it on an 844px screen — a thin strip, and **the tapped marker may sit *under* the sheet**. For a map app, keeping the focused feature in view matters; this likely requires offsetting MapLibre's bottom padding / recentering on snap change, which no lens specified.
2. `half` overlaps the bottom-left FamilyLegend and bottom-right `.map-attribution` license-floor (the four-corner anchor contract, CLAUDE.md §3 / spec §3). Resolving this collision is a **precondition** for `half`, not a follow-up. A peek-plus-identity-row detent (taller than 120px, far shorter than 506px) is an unconsidered alternative that may better preserve map context — see Open Questions.

---

## 4. Forward options

Three distinct paths. (Two library candidates the options lens scored low — `react-spring-bottom-sheet`, abandoned ~4yr / React-18 cap / deprecated transitive deps; and `vaul`, fixed Radix `role=dialog` fighting the per-snap flip — are excluded here; full write-ups exist in the options lens if needed.)

### Option A — Fix the hand-rolled sheet (no library) — RECOMMENDED
- **What it is:** ~6 edits in `SpeciesDetailSheet.tsx` + CSS: remove the upward `Math.max(0,…)` clamp on the active-drag transform; open at `half`; gate the CSS transition behind an `is-dragging` flag so the drag tracks 1:1 and the transition only runs on settle; add a velocity/flick model (px/ms over last N pointer samples) and replace the 50%-of-gap snap with a velocity+position decision; remove/repurpose the tap-cycle now that drag works. Plus the a11y fixes (F8/F9/F10) and the legend-collision resolution.
- **a11y-contract fit:** Fully preserved by construction — the inert→role sequencing, region↔dialog flip, heading-focus, and unmount cleanup are untouched; the fix is orthogonal gesture math. (Note: F8/F9/F10 are *additive* a11y work this option must still do — the existing contract is preserved, but the missing focus trap / restore / half-announcement should be fixed in the same pass.)
- **map-interactive-partial fit:** Unchanged and correct — peek (z-10) / half (z-15) never set inert; only full inerts `#map-layer`. This is the single hardest property for any library to express per-snap, and the hand-rolled code already nails it.
- **Effort (agentic):** One TDD implementer pass (failing unit specs for open-at-half, up-drag-moves, velocity-advance, settle-to-nearest, no-transition-while-dragging → implement → green) + one Playwright verification pass across the 5 canonical viewports × 2 themes (`sheet-snap.spec.ts`, `axe.spec.ts`, `safe-area.spec.ts`). No fan-out. **Test tax is near-zero:** there is no existing test asserting upward-advance or 1:1 tracking (F12), so F4/F5 are test-free to fix; the load-bearing inert↔role sequencing tests (`SpeciesDetailSheet.test.tsx:88-152`) stay green; only open-at-peek (`:46-61`) and the tap-cycle assertion (`:63-86`) need conscious updates.
- **Pros:** Zero new bytes (repo ships no animation/gesture lib — verified in `frontend/package.json`); all `data-testid`/`data-snap-state`/role selectors stay green; respects the global reduced-motion single-source-of-truth in `motion.css`; defects are individually small and already root-caused.
- **Cons:** You own the velocity/flick/momentum code by hand — the part libraries give free; needs a deliberate velocity model to feel polished; does not pay down any longer-term "adopt a standard sheet primitive" desire.

### Option B — Build on `motion` (framer-motion successor) — principled escalation only
- **What it is:** Keep all markup, role/inert/testid wiring, and the test suite; swap only the gesture internals for `motion` primitives (`drag="y"`, `useDragControls`, `useMotionValue`, spring `animate`).
- **a11y-contract fit:** Fully preservable — `motion` supplies only drag+spring, no portal/role/focus-trap, so the contract and selectors survive (same posture as Option A).
- **map-interactive-partial fit:** Identical to Option A — modality stays entirely ours.
- **Effort:** Comparable to Option A plus a dependency add and a `matchMedia('(prefers-reduced-motion: reduce)')` bridge (a JS spring bypasses the global `motion.css` rule, creating a second reduced-motion source of truth to keep in sync). Drag-simulation unit specs shift from synthetic PointerEvents to motion's model.
- **Pros:** Production-grade spring/velocity/flick for free while keeping the contract and DOM shape; most test-preserving of the library options; current and well-maintained (React 18/19).
- **Cons:** Adds an animation runtime (~30–50KB gz, est.) to a bundle that today ships zero; reduced-motion becomes a second source of truth; you still hand-assemble the snap-point state machine — only the physics are free.

### Option C — Adopt `react-modal-sheet` (turn-key, healthiest library) — not recommended
- **What it is:** Replace the surface with the library's compound `Sheet.*` components; map `snapPoints`/`initialSnap`/`onSnap`/`dragVelocityThreshold`.
- **a11y-contract fit:** Best of the libraries *by omission* — ships no built-in focus trap, so it doesn't fight our role/inert flip; but you re-own all a11y and must re-express the synchronous inert→role ordering around the library's settle callback.
- **map-interactive-partial fit:** Conditional — no first-class non-modal flag; you assemble it by omitting the backdrop and disabling scroll-lock (easy to get subtly wrong); it always portals to `document.body`.
- **Effort:** Two passes + a full unit-test rewrite (portal DOM shape invalidates current selectors and the MutationObserver order test).
- **Pros:** Actively maintained (published 2026-03); first-class snap points + velocity flick + a `prefersReducedMotion` prop.
- **Cons:** Pulls the full `motion` runtime as a peer (heaviest add); portal forces the test rewrite; you keep owning a11y *and* take on a heavy dep; second reduced-motion source of truth.

### RECOMMENDED: Option A (fix the hand-rolled sheet). Escalate to Option B (`motion`) only if hand-tuned physics feel inadequate after the fix.
**Rationale:** The defects are confirmed small, local gesture bugs, not architectural limits — the dead up-drag is one clamp, open-at-peek is one initial-state line, the lag is one always-on transition to gate, the velocity gap is one flick model. Against that, the repo's non-negotiable constraint is the thing libraries handle worst: **non-modal at peek/half, modal only at full, with inert sequenced before the role flip on advance and after it on collapse** — a per-snap contract that every library expresses only as a single per-instance prop, forcing an against-the-grain toggle. Every library also portals to body, changing the DOM shape and forcing a full rewrite of the inert→role ordering tests — pure tax with no reduction in the a11y surface we still own. Option A is zero bytes, keeps the entire test suite green, and respects the global reduced-motion source of truth. Option B is the only *library* path that also preserves the contract and tests, so it is the correct escalation if spring feel is judged essential — at the cost of one dependency and a reduced-motion bridge.

**Provisional-claim flag (defer to critique):** The options lens repeatedly justified avoiding a library via a "mobile bundle budget guard" (`mobile-bundle-e.spec.ts`). **That is FALSE** — per the options critique, that spec is issue #514's touch-target/overflow a11y suite (asserts `body.scrollWidth <= 390` and 44pt targets); it measures no bytes, and a repo-wide grep finds no bundle-size budget anywhere. The underlying merit (the repo deliberately ships zero animation libs, so adding one is a real footprint regression) holds and is verified; the *named CI enforcement mechanism does not exist*. Do not brief an implementer that adding `motion` would fail a bundle-size gate. Bundle-size figures (vaul ~15–25KB gz, motion ~30–50KB gz) are unverified estimates, not measured against this repo's tree-shaken build. Separately: the React-19 forward-compat argument is speculative — the repo is on React 18.2.0 today.

---

## 5. Out-of-scope but noted

- **Dead WIP files — do not mistake for the live path.** `SpeciesDetailModal.tsx` and `lib/use-is-mobile.ts` are untracked, unimported, and dead (F7, confirmed). The Modal passes `bbox`/`onClearBbox` into `SpeciesDetailSurface`, whose props are only `{speciesCode, apiClient}` — it would not even typecheck against the live surface. The live phone hook is `useIsPhone` (≤480px), not `useIsMobile` (≤760px); the live compact gate is `useIsCompact` (≤1199px). An implementer should treat these as cleanup-adjacent, not as the surface to fix.
- **Half-state legend z-collision (must be resolved as part of Option A/B).** At `half`, the collapsed FamilyLegend pill overlaps the description text and the bottom attribution (bottom-left z-collision). Opening at `half` makes this user-visible, so it is a *precondition* for the recommended detent, addressed within the four-corner anchor + z-tier system (peek=z-10 / half=z-15 / full=`var(--z-modal)` already encode the tier intent), not a deferred follow-up.
- **PEEK_PX desync hazard (F13).** If the fix changes peek height, three sites must move together: `PEEK_PX` (`SpeciesDetailSheet.tsx:21`), the hand-synced legend offset (`styles.css:1142-1145`), and the stale "96px" comment (`styles.css:1553`).
- **Documentation drift (F8 bonus).** `styles.css:1415-1421` asserts chrome is "non-interactive while the modal sheet is open" — true only for pointer click-through, not Tab focus. Fix or delete this comment when adding the focus trap.

---

## 6. Open questions for the user

1. **Default detent: `half` (506px) or a shorter identity-row detent?** `half` guarantees legibility but leaves only ~338px of map and may hide the tapped marker. A custom peek-plus-identity detent (taller than 120px, shorter than 506px) is closer to what Apple Maps actually does and preserves more map context. Which do you want as the open state?
2. **Should the map recenter / inset its bottom padding on snap change** so the tapped marker stays visible above the sheet? This is the standard native technique and is currently unimplemented. In scope for this fix, or a follow-up?
3. **At full, add a real focus trap, or drop the `aria-modal` claim?** Both are valid (F8). A focus trap preserves the modal semantics; dropping `aria-modal` (and inerting AppHeader too, or treating full as still-non-modal) is simpler. Which direction?
4. **Keep tap-to-cycle on the handle as a documented a11y shortcut** (Material 3 precedent) once drag works, or remove it entirely to avoid the inverted-affordance confusion?
5. **Is adopting a standard sheet primitive a longer-term goal?** If yes, that argues for Option B/`motion` now to pre-pay the runtime; if the answer is "keep it lean and hand-rolled," Option A is unambiguous.
