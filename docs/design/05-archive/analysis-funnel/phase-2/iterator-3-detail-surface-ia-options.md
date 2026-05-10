# Phase 2 Iterator 3: Detail Surface IA Options

## Assignment

Resolve Phase 1 tension #3 — "IA simplicity vs `detail` orphaning." Map four IA patterns for the detail surface. Do NOT pick a winner.

---

## Findings

### Finding 1 — Option A: Detail as a 4th Tab

**IA semantics.** Detail becomes a peer surface alongside Feed, Species, Map. The `TABS` array at `SurfaceNav.tsx:22–26` gains a fourth entry `{ value: 'detail', label: '…', accessibleName: 'Species detail view' }`. When no species is selected, the tab is hidden (CSS `display:none` or `visibility:hidden`); it appears and auto-selects when `state.view === 'detail'`. Conceptually, detail is *parallel* to the other surfaces — same level in the hierarchy, same navigation mechanism.

**A11y consequences.** The WAI-ARIA tablist contract at `SurfaceNav.tsx:79` (`role="tablist"`, `aria-controls="main-surface"`, roving tabindex, Arrow/Home/End keyboard nav — `SurfaceNav.tsx:40–73`) is fully preserved. `anyTabActive` at `SurfaceNav.tsx:76` returns `true` when on detail, so the tab is properly `aria-selected`. A dynamic tab count (3 → 4 when detail is populated) is unusual but valid per ARIA spec. Risk: Arrow key wrapping logic at `SurfaceNav.tsx:42–49` uses `TABS.length` — adding a conditional 4th entry requires care to keep modular arithmetic consistent when the tab is hidden vs. removed from the array.

**URL-state implications.** No change to `writeUrl`/`readUrl` (`url-state.ts:71–68`). `?view=detail&detail=<code>` already works. The `replaceState`-only architecture (`url-state.ts:87`) means browser back still does not traverse detail → previous surface. The tab provides a *visual* back path (click Feed/Species/Map tab), but not a *browser-back* path. Existing deep-link URLs are fully preserved.

**Mobile fit (390×844).** SurfaceNav already occupies ~44px. Adding a 4th tab compresses each tab to ~25% of the 390px width (~97px each). Current 3-tab layout gives ~130px each. Four tabs at this width are readable but tight — especially if the label "Detail" or a species name is used. A dynamic label showing the species common name (e.g., "Gila Woodpecker") would overflow at 97px and require truncation logic. A static label "Detail" avoids this but loses context.

**Implementation cost: small.** Add one `TabDef` to `TABS` at `SurfaceNav.tsx:22–26`, conditionally include it when `state.detail` is set, hide when absent. Pass `state.detail` into `SurfaceNav` as an optional prop. Add one CSS rule for `.surface-nav-tab[aria-hidden]`. No URL-state changes.

**Where does Back go?** Nowhere meaningful — browser back exits the app (or goes to the prior website) since all navigation is `replaceState` (`url-state.ts:87`). The tab simply becomes deselected when the user clicks Feed/Species/Map, which is an implicit "go back." Users who expect browser back to return to Feed will be surprised regardless. The 4th tab provides the clearest visual signal of "where am I," but not a back affordance.

---

### Finding 2 — Option B: Detail as a Modal / `<dialog>`

**IA semantics.** Detail becomes a modal overlay on top of the *current* surface. The surface behind (Feed, Map, or Species) remains visible and inert under the backdrop. Detail is *nested under* whichever surface triggered it — it does not replace `<main>`'s content (`App.tsx:181–219`) but overlays it. Semantically: detail is ephemeral context, not a peer destination.

**A11y consequences.** Reuse the `AttributionModal` pattern (`AttributionModal.tsx:182–261`): native `<dialog>`, `showModal()`, ESC closes natively, backdrop click closes, `queueMicrotask(() => closeBtn.focus())` on open, focus restoration to trigger element on close (`previouslyFocusedRef`, line 199). The codebase's existing modal pattern is comprehensively documented and axe-validated at desktop and mobile (`AttributionModal.tsx:19–38` documents all four idioms). The `SurfaceNav` tablist is entirely untouched — the selected tab (Feed/Species/Map) remains selected while the modal is open, which correctly reflects "you are on Feed, viewing detail as an overlay." The dialog needs `aria-labelledby` pointing to the species common name `<h2>`. One cost: the detail surface has analytics instrumentation (IntersectionObserver sentinel at `SpeciesDetailSurface.tsx:174–195`) that currently depends on `<main>` scroll — inside a `<dialog>` with `overflow-y:auto`, the scroll container changes and the sentinel observation must be re-wired.

**URL-state implications.** `?view=detail&detail=<code>` still works for deep-links, but on reload the modal opens over an empty surface — there is no "underlying surface" to restore. Must decide what surface renders *behind* the dialog on a cold load. Options: always open modal over Feed (default), or open over the surface implied by navigation history (unknowable without `pushState`). The `replaceState` architecture (`url-state.ts:87`) does not need to change for this pattern, but the UX of "page reload = modal on top of blank/feed" is awkward.

**Mobile fit (390×844).** The `AttributionModal` already has a mobile CSS rule: `width: calc(100vw - 2 * var(--space-md))` (area-3 analysis, `styles.css:732`). A species detail modal at full viewport width minus margins would work. A bottom-sheet variant (mobile: `position:fixed; bottom:0; left:0; right:0; border-radius 12px 12px 0 0; max-height:85vh`) is possible and common, but requires custom CSS beyond the existing modal pattern. The iNat photo at `480px max-width` (`styles.css:432`) renders well inside a full-width mobile modal. The phenology chart and description content would scroll within the modal.

**Implementation cost: medium.** Refactor `SpeciesDetailSurface` from an in-flow div (`App.tsx:213–218`) to a `<dialog>` wrapper. Port the `AttributionModal` open/close machinery (stash focus, `showModal()`, `queueMicrotask focus`, `handleClose`, `handleClick` backdrop). Re-wire IntersectionObserver sentinel to the dialog's scroll container. Add a close button (the pattern already exists at `AttributionModal.tsx:296`). Update `App.tsx` to not render `{state.view === 'detail' && state.detail && <SpeciesDetailSurface>}` as a main-replacing block but instead trigger modal open when state changes. `SurfaceNav` untouched.

**Where does Back go?** ESC or close-button closes the modal and returns to the underlying surface — which is the *current* surface at the time of opening. This is the strongest back-navigation answer of all four options: user taps a Feed row → modal opens over Feed → ESC → back on Feed, exactly where they started. Browser back does not need to be involved. The mental model is "temporary focus on detail, then dismiss to where you were." Note: `replaceState` means the URL still won't undo on browser back — a `?view=detail` deep-link opened in a new tab closes the modal to an empty surface, not to a previously seen surface.

---

### Finding 3 — Option C: Detail as a Slide-over Panel / Sheet

**IA semantics.** Detail renders as a persistent side panel (desktop: right rail anchored to the right edge of `<main>`; mobile: bottom sheet that slides up and can be swiped to dismiss). It overlays *but does not replace* the current surface. IA-wise this is similar to Option B (overlay, ephemeral) but without focus trapping — the underlying surface stays partially interactive. Detail is *contextual supplement* rather than a full-surface takeover.

**A11y consequences.** This is the most complex option for accessibility. A slide-over that does *not* use `showModal()` does not get browser-managed focus trapping — the underlying surface remains reachable by Tab, which is confusing while the panel is open. To replicate modal semantics without `<dialog>`, a custom `inert` attribute or `aria-modal="true"` + manual focus guard is required. The `inert` attribute disables all interactivity in the background content but has varying browser support and is not the established pattern in this codebase. The `SurfaceNav` tablist would need to decide: does it remain interactive while the panel is open? If yes, switching tabs collapses the panel (reasonable). If no, the tablist must be inerted, which breaks the tablist contract. Neither outcome is clean without additional engineering.

The codebase has zero precedent for slide-over panels or `inert` — the `AttributionModal` (`AttributionModal.tsx:182–261`) is the only overlay pattern and it uses `showModal()` focus trapping. A slide-over departs from both the existing pattern and requires new CSS (transform-based slide animation, which must be wrapped in `@media (prefers-reduced-motion: reduce)` per area-5 gap finding — `frontend/src/styles.css` has zero existing animation rules).

**URL-state implications.** Same as Option B: `?view=detail&detail=<code>` works. Cold-load with panel state is the same awkward problem. Desktop: the panel opens alongside the current surface (map, feed, species) — but URL has no "which surface is behind" param. Mobile bottom sheet: same issue.

**Mobile fit (390×844).** Bottom sheet is idiomatic on mobile — iOS and Android both teach users this pattern via system sheets. A 50–70% height sheet leaves the map or feed partially visible behind it, which provides context ("here's the bird you tapped on the map"). The slide-up animation is expected and appropriate. However, implementing a gesture-to-dismiss swipe requires either a drag event listener or a JS library, adding complexity. Without gesture-to-dismiss, a bottom-sheet is just a large non-closeable overlay until the user finds the close button. Desktop: a right rail at 360px width would leave the map at roughly 390px on a 750px mobile viewport — not applicable (slide-over right rails are desktop-only patterns; mobile always collapses to bottom sheet).

**Implementation cost: large.** New CSS: slide transition (both axes, reduced-motion variant), bottom-sheet vs. right-rail responsive breakpoint. New JS: focus management without `showModal()` (or polyfill inert), dismiss-on-background-click without backdrop. App.tsx layout: `<main>` must become a flex row (content + panel) on desktop, which changes the existing layout structure (`App.tsx:169–219`, `styles.css:86`). SurfaceNav: decide interaction with open panel. IntersectionObserver: must target panel scroll container (same issue as Option B). No URL-state changes needed but cold-load panel UX is unresolved.

**Where does Back go?** Dismiss button or swipe collapses the panel — user returns to the visible surface behind it. Browser back still does not work (`replaceState`). The partially-visible background surface gives a stronger spatial cue than Option B ("I'm looking at this bird from the map I can still see"), which may be the best answer to the "where am I" question — but at higher implementation cost.

---

### Finding 4 — Option D: Detail Stays Sub-surface, Gains Close Button + pushState

**IA semantics.** Keep the current architecture: detail renders in-flow inside `<main>` (`App.tsx:213–218`), replacing the current surface content, not represented in `SurfaceNav.TABS` (`SurfaceNav.tsx:22–26`). The two changes are: (1) add an explicit close/back button to `SpeciesDetailSurface.tsx` (currently documented as deliberately absent at lines 112–118: "No ESC dismiss, no overlay, no close button"), and (2) switch `writeUrl` from `replaceState` to `pushState` when transitioning *to* `view=detail`, so browser back returns to the previous surface.

**A11y consequences.** The `SurfaceNav` tablist is preserved unchanged. `anyTabActive` at `SurfaceNav.tsx:76` is `false` when `view=detail` — all tabs render `aria-selected="false"` and the first tab gets `tabIndex={0}` (roving tabindex fallback at `SurfaceNav.tsx:82`). This is a visible IA seam (no tab highlighted) but is not an ARIA violation — a tablist CAN have no selected tab. Adding a close button to `SpeciesDetailSurface.tsx` requires: button with `aria-label="Back"` or `aria-label="Close species detail"`, focus on mount (so keyboard users land on the close button when the surface opens), and focus restoration to the trigger element (the feed row or map popover link) on close. Focus restoration is harder than in the modal pattern — `SpeciesDetailSurface` doesn't know its trigger; the trigger ref must be lifted to `App.tsx` and passed down.

The `pushState` change (`url-state.ts:87`, changing `replaceState` to conditional `pushState`) enables the `popstate` listener at `url-state.ts:97–101` (`window.addEventListener('popstate', onPop)`) to fire when the user presses browser back, restoring the previous URL state (e.g., `?view=feed`). This is the only option that makes browser back work for detail → prior surface. However, `pushState` introduces history stack implications: the history stack grows with each detail visit. Users who open 10 species detail pages and then press back 10 times will traverse the entire history before leaving the app — which is expected behavior but must be accepted as a design decision.

**URL-state implications.** `writeUrl` at `url-state.ts:71–89` must conditionally call `pushState` (when transitioning TO `view=detail`) and `replaceState` (for all other state changes — filter changes, surface switches between feed/species/map). This requires adding a `push?: boolean` parameter to `writeUrl` or exposing a separate `push` path in `useUrlState.set`. The `readUrl`/`writeUrl` parameter logic is unchanged — existing URLs remain valid. The sniff logic at `url-state.ts:53–54` (absent `?view=` with `?detail=` set → view='detail') already handles cold loads. Deep-links continue to work because `pushState` vs `replaceState` is a runtime navigation distinction, not a URL-format distinction.

**Mobile fit (390×844).** A close/back button on the detail surface sits at the top of `<main>` content area (below `SurfaceNav` at ~y=174). A `← Back` button or `✕ Close` button at the top of `.species-detail-surface` (`styles.css:411`) is easy to reach and unambiguous. The button becomes the natural first keyboard focus target when the detail surface opens. No layout changes required — `SpeciesDetailSurface` already renders in the standard `max-width: 760px` container (`styles.css:411`).

**Implementation cost: small.** Add one `<button>` to `SpeciesDetailSurface.tsx` above the loading/error/data blocks. Wire `onClose` prop from `App.tsx:101–104` that calls `set({ detail: null, view: previousView })` — requires `App.tsx` to track `previousView` (a `useRef` that records `state.view` before each navigation to detail). For `pushState`: modify `writeUrl` at `url-state.ts:71–89` to accept a `push` flag; modify `useUrlState.set` to pass `push: true` when the next state has `view: 'detail'`. Total code delta: ~40 lines across `url-state.ts`, `App.tsx`, `SpeciesDetailSurface.tsx`.

**Where does Back go?** With `pushState` wired: browser back returns to whichever surface the user came from (feed, map, or species). The close button also returns there. This is the only option where both browser back AND an explicit button give the same "return to origin surface" behavior. The cost is: (a) `anyTabActive` remains false on detail (no tab highlights — the IA seam is acknowledged but not resolved), and (b) users who share a `?view=detail` URL see the detail surface with no obvious "go back" to a surface they haven't visited.

---

## Resolved Questions

1. **Is `anyTabActive = false` on detail an ARIA violation?** No — per `SurfaceNav.tsx:82`, the roving tabindex fallback (`!anyTabActive && index === 0`) keeps the first tab at `tabIndex={0}`, so keyboard users can still navigate the tablist. The tablist is structurally valid with no selected tab (WAI-ARIA allows `aria-selected=false` on all tabs simultaneously).

2. **Does Option B (modal) conflict with the CC BY attribution requirement?** No — `AttributionModal.tsx:16` documents that the Credits trigger in `<footer role="contentinfo">` satisfies CC §4(c) prominence. A detail modal is a separate overlay; it does not compete with the attribution modal and does not need to be mounted inside the footer.

3. **Does Option D's `pushState` break the `?view=hotspots` shim?** No — the shim at `url-state.ts:42–50` calls `replaceState` unconditionally on old bookmark load, before any detail navigation. `pushState` is only added for forward navigation to detail; the shim path is unchanged.

4. **Can Option A (4th tab) be hidden when empty without breaking the Arrow key modular arithmetic?** Yes, but care is required. The `activateIndex` function at `SurfaceNav.tsx:31–38` uses `TABS[index]` — if the 4th tab is conditionally in or out of the array (not just visually hidden), wrap count must be based on the *rendered* array length. Hiding via CSS (`aria-hidden=true` + `display:none`) instead of array removal keeps the keyboard contract simple but means the tab is focusable-when-hidden without `inert`. Best approach: keep 4 entries in a stable array, set `tabIndex={-1}` and `aria-disabled={true}` when no species is selected, and skip it in Arrow navigation using an `if (!tab.enabled)` guard in `activateIndex`.

---

## Remaining Unknowns

1. **Trigger focus restoration for Option D.** The close button in `SpeciesDetailSurface` needs to return focus to whichever element triggered the detail navigation (feed row, map popover link, SpeciesAutocomplete result). The trigger ref is not currently passed to `SpeciesDetailSurface` — `App.tsx:101–104` calls `set({ detail, view: 'detail' })` with no reference to the originating element. A `triggerRef` pattern (lift to `App.tsx`, clear on close) is needed and adds complexity that the modal pattern in `AttributionModal.tsx:195–199` already solves internally.

2. **Cold-load surface for Options B and C.** When a user opens `?view=detail&detail=ablkin` from a new tab or bookmark, Options B and C must decide what surface renders behind the overlay. There is no "previously visited surface" in URL state. Options: default to Feed, or render no underlying surface (just the detail overlay over blank `<main>`). The current Option D behavior (detail replaces `<main>` entirely) has no such ambiguity.

3. **Analytics sentinel re-wiring for Options B and C.** The `IntersectionObserver` at `SpeciesDetailSurface.tsx:174–195` observes `sentinelRef` (the last child of `.species-detail-body`) to detect "scrolled to bottom." Inside a `<dialog>` (Option B) or slide-over panel (Option C), the scroll container is the modal/panel interior, not `<main>`. The sentinel observation must target the new scroll root — confirm that `IntersectionObserver` with no explicit `root` option uses the viewport by default, or pass `root: dialogRef.current` explicitly.

4. **Option A dynamic tab label UX.** If the 4th tab displays the species common name as its label (e.g., "Gila Woodpecker"), max label length at 97px (four tabs, 390px viewport) will overflow. If it displays a static label ("Detail"), the tab has less contextual value. No data on how frequently users navigate *between* multiple species detail pages without returning to a list surface first — relevant to whether a dynamic vs. static label matters in practice.

5. **SurfaceNav tab highlight gap in Option D.** No tab is highlighted when on detail (by design). User research or qualitative testing would determine whether this causes orientation confusion in practice. The existing comment at `SpeciesDetailSurface.tsx:115–118` implies this was an intentional design decision, not an oversight — but the rationale is not recorded.

---

## Revised Understanding

The four options cluster along two axes: **overlay vs. replacement** (B/C vs. A/D) and **history-enabled vs. replaceState-only** (D with pushState vs. A/B/C).

The deepest constraint is the `replaceState`-only architecture (`url-state.ts:87`). Three of four options leave it unchanged and therefore leave browser back broken for in-app detail navigation. Only Option D requires a targeted `pushState` addition, and it is also the smallest code change — touching three files with ~40 lines. The `SurfaceNav` tablist's "no active tab on detail" seam is real but is not an ARIA violation and is resolved in only one option (A adds a 4th tab) without resolving the browser back problem.

The `AttributionModal` pattern (`AttributionModal.tsx:182–261`) is a fully exercised `<dialog>` implementation that Option B directly inherits, making Option B the fastest path to a modal-with-focus-management that the a11y suite already validates. Option C (slide-over) has no precedent in the codebase and introduces the most new surface (animation CSS, `inert`, custom focus management).

The "where does Back go?" question has the clearest answer under Options B (ESC/close → triggering surface, because it never left) and D with pushState (browser back → triggering surface, explicit). Options A and C give spatial cues (A: tab shows "you are on detail"; C: background surface visible) but do not give a navigable back path without `pushState`.
