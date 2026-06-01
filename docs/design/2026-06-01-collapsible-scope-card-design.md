# Collapsible scope card + ZIP submit fix — design

- **Date:** 2026-06-01
- **Status:** Approved (brainstorm); pending implementation plan
- **Surface:** top-left identity/scope card (`AppHeader` identity card)
- **Design authority:** `docs/design/2026-05-30-floating-ui-design-spec.md` §3 (four-corner contract), §4.1–4.3, §5.2 (hierarchy)
- **Relates to:** epic #761 (map-first re-arch), #800/#779/#780 (header → corner cards), #737/#739/#740 (scope control + ZIP)

---

## 1. Problem

The top-left identity card (`frontend/src/components/AppHeader.tsx:146-222`) shows **eight stacked elements at rest** and renders the active region **three times** — in the wordmark suffix (`AppHeader.tsx:157-159`), as the `<h1>` region name (`:170-174`), and inside the lede sentence ("…seen across Arizona…", `App.tsx:890`). Below a hairline it then shows a full re-scope **form** (state `<select>` · ZIP · "Whole US" · "Change scope"). The spec's own hierarchy (§5.2) wants the scope control *de-emphasized* — "not the loudest card on the map" — yet at rest the form is the heaviest thing there.

Separately, **ZIP entry has no submit affordance.** `ZipInput` (`frontend/src/components/ZipInput.tsx:82-110`) is a `<form>` with a single `<input>` and **no submit button**; it relies on the browser's implicit "Enter submits a one-input form." On desktop that means Enter-only. On iOS the field is `inputMode="numeric"` (`ZipInput.tsx:88`) → the numeric keypad has **no Return/Go key** → with no button there is *no submit path at all*. The same component is embedded in the landing chooser (`ScopeChooser.tsx:103`), where the inconsistency is visible: the State row right below it has a `[Go]` button (`ScopeChooser.tsx:129-135`) and the ZIP row does not.

The spec already prescribes the fix for the first problem — §4.2 and the mobile composition map (§3) both say the scope control should "collapse to a single `Arizona ▾` pill that expands the scope rows on tap" — but it was scoped to `<480px` and **never implemented** (the JSX renders the full `ScopeControl` at every width; the `≤480` CSS only reflows it). This design makes that collapse the **universal default**, triggered by a **search icon**, and fixes the ZIP submit bug.

## 2. Goals / non-goals

**Goals**
- Resting card = two lines only: `Bird Maps · {Region}  🔍` and a count-only lede (`331 species`).
- The scope **form** collapses behind a search-icon disclosure and **expands in place**.
- Region appears **once** (visually, in the wordmark line); the `<h1>` is preserved for a11y.
- ZIP is submittable by pointer and by keyboard on every platform.

**Non-goals**
- No change to the top-right controls pill, family legend, detail card, or filters panel.
- No change to the scope form's *fields* (state select / Whole US / Change scope) — only their visibility (behind the disclosure) and the ZIP submit affordance.
- No redesign of the landing `ScopeChooser` layout (it inherits the shared `ZipInput` button fix only).
- Removing the now-dead `MapLede.tsx` is **out of scope** (separate cleanup — see §11 note).

## 3. The redesigned card

```
 RESTING (all breakpoints)              EXPANDED (tap 🔍)
┌────────────────────────────┐         ┌────────────────────────────┐
│ Bird Maps · California  🔍 │   ───→   │ Bird Maps · California   ✕ │
│ 331 species                │         │ 331 species                │
└────────────────────────────┘         │ ─────────────────────────  │
                                        │ [ Switch state    ▾ ]      │
 Two lines, full stop.                  │ [ ZIP____ ] [ Go ]   ← fix │
 Region once (wordmark line).           │ Whole US · Change scope    │
                                        └────────────────────────────┘
```

- The **search-icon button** sits on the wordmark row (a card-level action) and toggles glyph `🔍` (collapsed) ↔ `✕` (expanded).
- **Expand grows the card in place** — the card is already `display:flex; flex-direction:column` (`styles.css:355-357`), so the scope rows appear below as additional flex children. No anchored popover, no flip/shift/clamp math. This is exactly the spec's "expands the scope rows on tap" (§4.2).
- Separator between brand and region is `·` (the established style, `AppHeader.tsx:158`); keep it. (The approval sketch used `-`; treated as cosmetic — default to `·`.)

## 4. Lede content contract

The lede loses the **region** (now the headline) and the **time window** ("in the last 14 days"). The producer is the `ledeText` useMemo in `frontend/src/App.tsx:870-899` (templates at lines 883/886/888/890). All five variants, shortened identically:

| Case | Today | New |
|---|---|---|
| Default (T4, `:890`) | `331 species seen across California in the last 14 days.` | `331 species` |
| Family filter (T3, `:888`) | `12 species of woodpeckers seen across California…` | `12 species of woodpeckers` |
| Single species (T2, `:886`) | `42 sightings of Western Bluebird in California…` | `42 sightings of Western Bluebird` |
| Sparse region (`:883`) | `No recent sightings in California yet.` | `No recent sightings` |
| Filtered-to-empty (`:884`) | `No sightings match your current filters.` | `No matches for these filters` |

- Singular/plural: a count of 1 routes to the **single-species** branch *when the common name is present* (`App.tsx:877-878`), rendering "42 sightings of …" rather than "1 species". If the name is absent it falls through to "1 species", which still reads correctly. No template needs a plural-aware rewrite.
- The **cold-load suppression** (`App.tsx:876`, #716/#720) is unchanged — `ledeText` still returns `null` while the first fetch is in flight, so the resting card shows just the wordmark line until data settles.
- The `period`/`periodClause` derivation (`App.tsx:879-880`) is **removed** (no window in the copy).

### a11y: the single `<h1>`

The page must keep exactly one `<h1>` (A11Y-3). The region moves into the visible wordmark line, so:

- Keep an `<h1 class="app-header-region-name">{region}</h1>` but render it **visually hidden at all breakpoints** (`sr-only`) — the pattern the card already uses at `<480px` (`AppHeader.tsx:171`, `styles.css:519-522`). The visible "California" lives in the wordmark line; the sr-only `<h1>` preserves heading structure.
- The existing scope-change live region — `<span class="sr-only" role="status" aria-live="polite">Showing {region}.</span>` (`AppHeader.tsx:183-187`) — is **unchanged**. Region is still announced on chooser→state and state→state transitions.
- The result-settle narration reuses `ledeText` (`App.tsx:911-923`). After the change the SR hears "Showing California." then "331 species" — region still conveyed (by the live region), no duplication. **No a11y regression.**

## 5. Freshness removal + knip consequence

The freshness line (`AppHeader.tsx:197-198`, `.app-header-freshness`, e.g. "Updated 11 min ago · Source: eBird") is **cut entirely** — the bottom-right attribution already carries source/licensing, and recency isn't worth a permanent line on a card we're minimizing.

Removal chain (verified — freshness is **produced** only in `App.tsx` and **rendered** only in the AppHeader freshness line, which this design removes):
1. Remove the `<p class="app-header-freshness">` render and the `freshnessLabel` prop from `AppHeader` (`AppHeader.tsx:93-97,125,197-199`).
2. Stop passing `freshnessLabel` from `App.tsx:1011`.
3. With the lede period clause also gone (§4), `freshnessState` loses its last use (`App.tsx:880,896`). The `deriveFreshness` call (`App.tsx:860-863`) and `lib/freshness.ts` become **dead code**.

> **⚠ knip / Mergify gotcha (CLAUDE.md):** branch protection lists `knip (informational)` as a required check, so a newly-unused `lib/freshness.ts` / `deriveFreshness` export **blocks the Mergify queue**. Resolve it **in the same PR**: delete `lib/freshness.ts` + `lib/freshness.test.ts` + `config/freshness.test.ts` (recommended — don't keep dead code for a hypothetical), **or** add a dated knip ignore-rule with justification if freshness is expected to return. Recommended: delete.

## 6. ZIP submit fix

Add a visible submit control **inside `ZipInput`'s own form** (`ZipInput.tsx:82-110`), in a row with the field:

```tsx
<div className="zip-input__row">
  <input … />
  <button type="submit" className="zip-input__submit">Go</button>
</div>
```

- One change fixes **all three** call sites at once: header `ScopeControl` (`:121`), landing `ScopeChooser` (`:103`), dev harness (`DsPreview.tsx`). It also makes the ZIP row match the State row's existing `[Go]` (`ScopeChooser.tsx:129-135`).
- The button calls the same `handleSubmit` (`ZipInput.tsx:53`). The four-outcome "never silent" contract (`ZipInput.tsx:53-80`) is **untouched** — malformed / notRecognized / fetchError feedback is unchanged.
- **Disabled logic (a real UX decision, deferred to the plan):** either always-enabled (submit a bad value → inline "Enter a 5-digit ZIP" hint, preserving the never-silent contract) **or** disabled-until-non-empty. Recommended: **always-enabled**, so the malformed hint stays reachable by pointer users exactly as it is for keyboard users today. Do **not** disable-until-5-digits — that would hide the malformed-feedback path.
- Label "Go" matches the chooser; accessible name is the visible text.

## 7. Interaction & accessibility (the disclosure)

Reuse the disclosure pattern **already in this file** — the Filters trigger (`AppHeader.tsx:252-283`):

- The 🔍 button carries `aria-expanded={open}` and an accessible label ("Change region" when collapsed). It controls the scope region via `aria-controls={scopeRegionId}` — valid because the scope form is **mounted but CSS-hidden** when collapsed (an always-present IDREF target, unlike the conditionally-rendered Filters dialog which deliberately omits `aria-controls`, `AppHeader.tsx:68-74`).
- **Open:** reveal the rows; move focus to the first field (the state `<select>`).
- **Close:** `Esc` collapses and returns focus to the trigger; the glyph returns to 🔍.
- **No click-outside-to-close** — a stray map click must not discard a half-typed ZIP. (Differs from the Filters sheet, which is modal; this is a non-modal in-place disclosure on a tier-1 card.)
- Disclosure open/closed state is component-local React state in `AppHeader` (it does not belong in the URL — re-scoping is the persisted action, not the panel's open/closed state).

## 8. Design-system compliance

- **Four-corner contract (§3):** unchanged — still one top-left card. No new band, no new corner. ✔
- **Elevation:** the card stays **tier-1** resting chrome (`--card-elevation-1`) in both states; the in-place expansion does not promote it to a transient/modal tier. ✔
- **Tokens:** new sub-elements (search button, ZIP submit, ZIP row) consume existing tokens (`--card-radius-inner`, `--space-*`, `--color-*`, the 36/44px touch-target minimums already used by `.app-header-filters`, `styles.css:487-518`). No new geometry tokens.
- **Orphan-className gate (CLAUDE.md):** every new className (`.app-header-search`, `.zip-input__row`, `.zip-input__submit`, any `[data-open]` hook) needs a matching CSS rule in the same PR.

## 9. Responsive behavior

The resting card is two lines at **every** breakpoint, so the layout is now near-identical across the canonical viewport set (390 / 768 / 1024 / 1440 / 1920). Verify:

- **390 (mobile):** the card must clear the controls pill (existing width cap `styles.css:540-542`). Touch targets ≥44px for the 🔍 and `[Go]` buttons (matches `styles.css:513-518`). Expanded form must fit the narrow column without horizontal overflow (the scope-control mobile reflow already exists, `styles.css:2154-2167`).
- **≥1440:** wide corner insets (`--card-inset-wide`) unchanged.
- Per the repo UI-verification protocol: 5 viewports × 2 themes (light/dark), resting **and** expanded, console clean (zero warnings).

## 10. Ship plan — two PRs

The ZIP fix is independent, small, and possibly an iOS blocker; it should not wait on the redesign.

- **PR A — `fix(frontend): add a submit button to ZipInput`.** §6 only. Touches `ZipInput.tsx`, `ZipInput.test.tsx`, CSS, and the `zip-scope` e2e. Ships immediately.
- **PR B — `feat(frontend): collapse the scope form behind a search disclosure`.** §3–5, §7. The card restructure, the lede dedupe, the freshness removal (+ knip cleanup), and the disclosure. Depends on nothing in PR A (different surface), but sequencing A first keeps PR B's diff focused.

## 11. Blast radius (files, tests, specs)

**Source**
- `frontend/src/components/AppHeader.tsx` — disclosure state + 🔍/✕ trigger; region into wordmark line; `<h1>` always `sr-only`; lede row stays, freshness row removed; scope rows behind the disclosure. (PR B)
- `frontend/src/components/ZipInput.tsx` — submit button + `.zip-input__row`. (PR A)
- `frontend/src/App.tsx` — `ledeText` templates shortened (`:881-890`); remove `period`/`periodClause`; remove `freshnessLabel` pass (`:1011`); remove `deriveFreshness` call + import (`:34,860-863`) once orphaned. (PR B)
- `frontend/src/styles.css` — collapsed/expanded card states; `.app-header-search`; `.zip-input__row`/`.zip-input__submit`; remove `.app-header-freshness` rule (`:419-425`). (PR A: zip; PR B: rest)
- **Delete** (PR B, knip): `frontend/src/lib/freshness.ts` (+ `lib/freshness.test.ts`, `config/freshness.test.ts`) — or knip-ignore with justification.

**Docs**
- `docs/design/01-spec/voice-and-content.md` — update the Lede contract to the count-only forms (§4 table). (PR B)

**Tests**
- e2e: `frontend/e2e/zip-scope.spec.ts` (ZIP submit via button — PR A; lede copy — PR B), `frontend/e2e/map-lede-cls.spec.ts` (lede copy + the resting two-line card — PR B), `frontend/e2e/map-cold-load.spec.ts` (suppression unchanged, copy updated — PR B), `frontend/e2e/pages/app-page.ts` (POM: add the disclosure trigger + `[Go]`; lede getter copy).
- unit: `AppHeader.test.tsx` (disclosure open/close + focus + Esc; freshness row gone; count-only lede; sr-only h1), `App.test.tsx` (lede useMemo short-forms; no period clause), `ZipInput.test.tsx` (button submits; malformed-on-button preserves never-silent). `MapLede.test.tsx` tests dead code (see note).
- new e2e: disclosure expand/collapse + keyboard (Esc, focus move) at representative viewports.

> **Note — `MapLede.tsx` is already dead code.** It is not imported outside tests (`App.tsx:866` comment confirms its template logic "now removed from MapSurface" and mirrored into the `ledeText` useMemo). It is **not touched** by this work; flag for a separate knip cleanup so this PR's diff stays scoped.

## 12. Risks / open questions

1. **knip blocks the queue** (§5) — the freshness deletion must land in PR B itself, or PR B can't merge. Highest-attention item.
2. **e2e copy churn** — three specs assert the old lede strings; they must move in lockstep with `App.tsx` (the #741 "copy in lockstep" convention). A missed string fails CI, not silently.
3. **Count-only lede drops the window** — "331 species" no longer states "in the last 14 days"; the window is discoverable only via Filters. Accepted (explicit product call).
4. **Separator** `·` vs `-` — cosmetic; default `·`, trivially flipped if desired.
5. **Disabled-submit decision** (§6) — recommended always-enabled; final call belongs in the plan/implementation.
