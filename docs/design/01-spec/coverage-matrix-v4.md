# Sky Atlas v4 — Mock-to-Spec Coverage Matrix

**Version:** v4 (2026-05-11)
**Scope:** Every visual property *named in a committed brainstorm artifact* (`05-archive/brainstorm-mocks/` or `05-archive/design-agents/`). Properties never mentioned in any brainstorm artifact are out of scope — this is a deliberate false-precision guard. The discovery set is 74 rows; this matrix itself is the canonical record of the area-2 audit findings.

---

## Disposition Legend

| Disposition | Meaning |
|---|---|
| `CAPTURED` | Property is fully spec-contracted; citation to spec file:line provided |
| `DROPPED — UNSTATED` | Property present in brainstorm artifact, absent from all spec files, no documented rationale |
| `DROPPED — DOCUMENTED` | Property present in brainstorm, explicitly rejected or scoped out with rationale in spec |
| `MODIFIED — UNSTATED` | Property present in brainstorm, partially captured in spec, but the delta (what changed) is not documented |
| `MODIFIED — DOCUMENTED` | Property present in brainstorm, captured in modified form, delta explained in spec |
| `DEFERRED-INTENTIONAL` | Property present in brainstorm, carried as an open question (G1–G8) or "deferred to v1.1" in spec |
| `REJECTED-IN-BRAINSTORM` | Property proposed in brainstorm but rejected within the brainstorm process itself (agent dissent adopted); not a spec responsibility |

**Primary signal:** `DROPPED — UNSTATED` and `MODIFIED — UNSTATED` entries are the actionable findings — silent losses that have no breadcrumb for a future spec author or implementer.

---

## Coverage Matrix

| Visual property (from mock) | Source (brainstorm artifact, line/section) | Disposition | Captured-in (spec file:line) | Notes |
|---|---|---|---|---|
| 3-tier token architecture (primitive → semantic → component) | agent-2 idea 1; v4 K3 `sky-atlas-v4.html:615-618` | `CAPTURED` | `tokens.md:7-90` | — |
| `--color-decision-point` accent token (distinct from `--color-accent-notable-fg`) | v4 K3 token mapping `sky-atlas-v4.html:18-20` | `CAPTURED` | `tokens.md:53,109,114-122` | Lint guard included |
| `--c-deep-ember: #c43a1a` for notable (light mode) | v4 light tokens `sky-atlas-v4.html:20` | `CAPTURED` | `tokens.md:27,59` | Spec preserves existing token name via semantic mapping |
| `--c-orange-500: #f5853b` (sunrise) | v4 light accent `sky-atlas-v4.html:18` | `CAPTURED` | `tokens.md:25` | — |
| `--c-cyan-500: #6db8d4` (moon) | v4 dark accent `sky-atlas-v4.html:39` | `CAPTURED` | `tokens.md:26` | — |
| Density triad: Sky `#6ec5d9` / Sand `#e8c060` / Ember `#e87a4a` with measured contrast | agent-3 idea 1; v4 `sky-atlas-v4.html:21-23` | `CAPTURED` | `tokens.md:20-22` | Measured contrast ratios included |
| 6-step type ramp (11/13/15/17/22/34) | agent-4 idea 7; v4 `sky-atlas-v4.html:25-26` | `CAPTURED` | `tokens.md:127-147` | `--lede-size: 26px` exception added; v3 had it visually at `sky-atlas-v3.html:288` |
| `[data-theme]` attribute on `<html>` with localStorage persistence | agent-2 idea 5 | `CAPTURED` | `tokens.md:160-184` | Inline-script FOUC mitigation specified |
| MapLibre basemap swap on theme change (positron → dark-matter) | agent-2 idea 5 closing | `CAPTURED` | `tokens.md:179` | MutationObserver mechanism specified |
| `<StatusBlock>` primitive — 9 ad-hoc classes collapse to 1 | agent-2 idea 2; v4 spec-only K4 `sky-atlas-v4.html:657-660` | `CAPTURED` | `components.md:19-41` | 5 surfaces enumerated |
| `<StatusBlock>` flat skeleton + 2px sunrise progress bar (no shimmer) | agent-4 idea 7; v3 mock `sky-atlas-v3.html:639-647` | `CAPTURED` | `components.md:34` | Explicitly "no shimmer" |
| `<Photo>` priority prop (LCP fix) | v4 spec-only K5 `sky-atlas-v4.html:627-630` | `CAPTURED` | `components.md:51,68` | — |
| `<Photo>` 4-state machine (null/loading/loaded/errored) | v4 spec-only K4 `sky-atlas-v4.html:657-660` | `CAPTURED` | `components.md:58-65` | Full state table |
| `<Photo>` does not compose with `<StatusBlock>` | v4 spec-only K4 `sky-atlas-v4.html:658` | `CAPTURED` | `components.md:38,165` | Explicit non-composition rule |
| `<FamilySilhouette>` shape pairing (circle/square/pentagon/diamond) for WCAG 1.4.1 | agent-3 idea 7; v3 legend `sky-atlas-v3.html:980-1003` | `CAPTURED` | `components.md:81,84` | — |
| `<ClusterPill>` thresholds `sand: 100, ember: 750` | v4 spec-only K2 `sky-atlas-v4.html:648-651` | `CAPTURED` | `components.md:101-109` | In `config/cluster.ts` |
| `<ClusterPill>` ARIA `role="img" aria-label="{N} sightings"` | v4 spec-only K3 `sky-atlas-v4.html:677-680` | `CAPTURED` | `components.md:115-126`; `accessibility.md:112-127` | — |
| `<FilterSentence>` 500ms debounce + 1500ms clear-hold | v4 spec-only L3K2 `sky-atlas-v4.html:672-675` | `CAPTURED` | `components.md:154-158` | — |
| `<FilterSentence>` template "Showing {filter-terms} from the last {period}" | v4 spec-only K5; v3 mock `sky-atlas-v3.html:295-304` | `CAPTURED` | `components.md:140-145` | — |
| `<FilterSentence>` returns null at zero filters | v4 visual delta 3 `sky-atlas-v4.html:527-606` | `CAPTURED` | `components.md:140` | — |
| Sort prefix as separate `<SortLabel>` (not part of `<FilterSentence>`) | v4 spec-only K5 `sky-atlas-v4.html:664` | `CAPTURED` | `components.md:161` | Explicitly separated |
| Detail dialog `<h1 id="detail-title" tabIndex={-1}>` heading | v4 spec-only L3K1 `sky-atlas-v4.html:666-669` | `CAPTURED` | `accessibility.md:62-69` | — |
| Initial dialog focus on heading, not close button | v4 L3K1 `sky-atlas-v4.html:669` | `CAPTURED` | `accessibility.md:72-78` | queueMicrotask pattern specified |
| Bottom-sheet role flips with snap state (region → dialog) | v4 spec-only L3K4 `sky-atlas-v4.html:681-684` | `CAPTURED` | `accessibility.md:82-110` | Full state table |
| Bottom-sheet NOT a `<dialog>` element | v4 L1K3 `sky-atlas-v4.html:621-624` | `CAPTURED` | `accessibility.md:82`; `architecture.md:48-49` | Explicit |
| `inert` on map container before role flip to dialog | v4 L3K4 `sky-atlas-v4.html:683` | `CAPTURED` | `accessibility.md:91` | Sequencing detail specified |
| Reduced-motion global rule + MapLibre easeTo guard | v4 spec-only L3K5 `sky-atlas-v4.html:687-689` | `CAPTURED` | `motion.md:10-23,54-79` | `motion.css` as SoT |
| Cluster pill hover transform exception for reduced-motion | v4 implied; agent-1 idea 6 spring | `CAPTURED` | `motion.md:37-46` | — |
| Duration tokens (`--dur-fast: 200`, `--dur-base: 250`, `--dur-slow: 350`) | system-poster `sky-atlas-system.html:302-304` | `CAPTURED` | `motion.md:100-113` | — |
| Lede contract — 4 templates in priority order | v4 spec-only L1K1 `sky-atlas-v4.html:617-620` | `CAPTURED` | `voice-and-content.md:32-49` | Full priority table |
| Lede drops period clause under stale data | v4 spec-only L1K7 `sky-atlas-v4.html:637-640` | `CAPTURED` | `voice-and-content.md:42` | — |
| Freshness label state machine (fresh/recent/stale/error) | v4 spec-only L1K7 `sky-atlas-v4.html:637-640` | `CAPTURED` | `voice-and-content.md:52-68` | Full state table |
| Accent discipline — 8 enumerated sites | agent-4 idea 4; v4 visual-delta 2 `sky-atlas-v4.html:491-525` | `CAPTURED` | `voice-and-content.md:78-88` | Numbered table |
| Popover CTA loses accent (becomes underline link) | v4 visual delta 2 `sky-atlas-v4.html:491-525` | `CAPTURED` | `voice-and-content.md:90-92` | Explicit exclusion listed |
| Region as config (`REGION_LABEL` constant) | v4 spec-only L1K6 `sky-atlas-v4.html:632-635` | `CAPTURED` | `voice-and-content.md:44`; `architecture.md:67` | — |
| Family palette as JS lookup `getFamilyChannel(code)` (CSS path retired) | v4 spec-only L2K1 `sky-atlas-v4.html:642-645` | `CAPTURED` | `accessibility.md:39`; `components.md:84` | — |
| `pushState` on detail-surface entry | Analysis report drove this (not in mocks directly) | `CAPTURED` | `url-state.md:24-67` | Drives Theme 2.4 fix |
| `DEFAULTS.view: 'map'` (home route flip) | Implicit; v3 URL shows `bird-maps.com/?view=map` | `CAPTURED` | `url-state.md:6-22` | Resolves S4 explicitly |
| Bottom-sheet snap heights (peek 96px, half 60%, full 100-8px) | v4 L1K3 `sky-atlas-v4.html:622-624` | `CAPTURED` | `architecture.md:43-47` | — |
| Subtractive accent discipline (3-channel separation) | agent-4 idea 4 | `CAPTURED` | `voice-and-content.md:104-108` | Stylelint guard included |
| Focus halo (2px outline + 2px outline-offset gap) | agent-3 idea 5; v3 chip-focus-demo `sky-atlas-v3.html:261-264` | `CAPTURED` | `accessibility.md:46-58` | `color-mix` for 3:1 |
| 44px content tap targets, 32px chrome allowed | Existing baseline | `CAPTURED` | `accessibility.md:42` | Preserved |
| `<dialog>` native modal pattern for detail | agent-4 idea 6; v3 detail-d mock | `CAPTURED` | `accessibility.md:20-23`; `architecture.md:41` | — |
| Active SurfaceNav tab as underline (not filled chip) | v3 nav `sky-atlas-v3.html:227-236` (`::after` 2px underline with accent) | `CAPTURED` | `voice-and-content.md:81` | Accent site #1 |
| Mobile bottom-tab uses accent for active state | v3 mobile `sky-atlas-v3.html:672`; v4 `sky-atlas-v4.html:243` | `CAPTURED` | `voice-and-content.md:88` | Accent site #8 |
| `[Attribution]` link in header (replaces mobile Credits tab) | v4 visual delta 1 `sky-atlas-v4.html:403-489` | `CAPTURED` | `architecture.md:33-37` | Explicit removal of footer + Credits tab |
| Inline blocking script for FOUC-prevention on theme | agent-2 idea 5; v4 implied | `CAPTURED` | `tokens.md:166-176` | Verbatim snippet specified |
| Stylelint / grep guard against `--accent` token name | v4 K3 `sky-atlas-v4.html:653-655` | `CAPTURED` | `tokens.md:114-122` | — |
| Notable-vs-accent stylelint guard | v4 spec-only K3 implicit | `CAPTURED` | `voice-and-content.md:98-102` | Separate grep guard |
| Notable affordance: card layout + label text constraint | v4 spec-only L3K6 `sky-atlas-v4.html:691-694` | `CAPTURED` | `accessibility.md:144-145` | — |
| Position B opinionated-utility voice | Analysis report + agent-1 idea 1 | `CAPTURED` | `voice-and-content.md:5-29`; `open-questions.md:21-27` | G1 closed 2026-05-10 |
| `<dialog>` species name as `<h1>` (heading, not div) | v4 L3K1 `sky-atlas-v4.html:666-669` | `CAPTURED` | `accessibility.md:60-79` | `<h2>` rank-choice clause included |
| iOS safe-area `env(safe-area-inset-bottom)` | Implicit in bottom-tab + sheet | `DEFERRED-INTENTIONAL` | `open-questions.md:67-71` | G6 — "Pending"; not deferred-to-v1.1 |
| Family-color × basemap contrast audit | agent-3 idea 7 implied (light); agent-5 dark-basemap counter | `DEFERRED-INTENTIONAL` | `open-questions.md:75-80` | G7 — "Gates Phase 1's family-palette commit" |
| Dark basemap (positron → dark-matter) | agent-2 idea 5 closing | `DEFERRED-INTENTIONAL` | `open-questions.md:83-88` | G8 — "Deferred to v1.1; ship light-only if G8 fails" |
| Bundle size baseline | agent-2 idea 1 closing | `DEFERRED-INTENTIONAL` | `open-questions.md:38-46` | G3 — "Pending" |
| Stillness mode (3rd reduced-motion variant) | agent-3 idea 3 | `DEFERRED-INTENTIONAL` | `architecture.md:97` | "Deferred v1.1" |
| Geolocation "near me" default | agent-1 idea 7 | `DEFERRED-INTENTIONAL` | `architecture.md:98` | "Deferred v1.1" |
| Cluster manifest keyboard sidebar | agent-3 idea 6 | `DEFERRED-INTENTIONAL` | `architecture.md:99` | "Deferred v1.1" |
| Webfont (Source Serif Pro / Inter proposal) | agent-2 idea 4 closing; agent-5 Field Notebook | `DEFERRED-INTENTIONAL` | `architecture.md:96`; `tokens.md:157` | "System stack is the brand for v1" |
| Spring-physics overshoot on popover entry (`cubic-bezier(0.34,1.56,0.64,1)`) | agent-1 idea 6 | `DEFERRED-INTENTIONAL` | `motion.md:95` | "Deferred to v1.1" |
| Skeleton shimmer (Idea 2 of agent-1) | agent-1 idea 2; `sky-atlas-v3` reference | `DROPPED — DOCUMENTED` | `motion.md:91` | "Cargo-cult; against iOS-restraint posture" |
| Body background radial-gradient (ellipse at 25% 30%, sunrise + daylight blue layers) | v4 map-area `sky-atlas-v4.html:251-264`; also v3 `sky-atlas-v3.html:325-340` | `DEFERRED-INTENTIONAL` | `open-questions.md` W5 spec captures section | Flat `--color-bg-page` adopted; gradient deferred to v1.1 as optional atmosphere overlay. Rationale: contrast predictability, mobile perf, contrast-arithmetic simplicity. Future token: `--color-bg-atmosphere-light/dark`. Documented 2026-05-11 |
| `--accent-secondary: #1d3b5b` (deep sky) and `--accent-cool: #4a7ba8` (daylight blue) from system poster | system-poster `sky-atlas-system.html:17-18` | `DROPPED — DOCUMENTED` | `open-questions.md` W5 spec captures section; `voice-and-content.md:104-108` | System poster 3-accent option compressed to 1 (`--color-decision-point`) under subtractive discipline. Rationale in `voice-and-content.md:104-108`. Cross-link added 2026-05-11 |
| Cluster pill `::before` colored dot prefix (dot inside the pill) | v3 cluster idiom `sky-atlas-v3.html:373-381`; adopted in v4 visually | `DEFERRED-INTENTIONAL` | `components.md` ClusterPill section (W5 note) | Dot dropped in v1: density already encoded by border color + size tier; dot adds compositing cost on a high-density map canvas. Spec note added. v1.1 follow-up: #475. Documented 2026-05-11 |
| Photo attribution overlay scrim color (`rgba(0,0,0,0.55)`) | agent-2 idea 6 | `CAPTURED` | `components.md` Photo section (W5 masthead overlay contract) | Scrim `rgba(0,0,0,0.55)` now contractually specified; token `--color-photo-attribution-scrim` introduced. Captured 2026-05-11 |
| Italic scientific-name typography | v3 popover `sky-atlas-v3.html:466`; v3 detail `sky-atlas-v3.html:531`; v3 sheet `sky-atlas-v3.html:752`; v4 popover; system-poster | `CAPTURED` | `tokens.md` Typography contracts §1; `voice-and-content.md` Typography conventions §sci-name italic | `<em>` element contracts the italic via UA default; explicit spec entry added. Captured 2026-05-11 |
| Inline-measured contrast comments extended to canvas paint expressions | agent-3 idea 1 closing | `MODIFIED — UNSTATED` | `accessibility.md:33-39` | Partial capture — extension enumerated but no CI enforcement added (unlike the lint guard at `tokens.md:114-122`); delta between "enumerated" and "enforced" is undocumented. Remains open for a future CI-enforcement PR |
| `<Photo>` masthead overlay treatment (gradient + white species-name text + credit position) | agent-4 idea 6; v3 detail `sky-atlas-v3.html:496-528` (`linear-gradient(180deg, transparent 0%, transparent 50%, rgba(0,0,0,0.7) 100%)`) | `CAPTURED` | `components.md` Photo section (W5 masthead overlay contract) | Full gradient + text + credit position contract added. Captured 2026-05-11 |
| Detail surface as full-bleed at desktop (not modal-width dialog) | v3/v4 detail-desktop mockup `sky-atlas-v3.html:486-558` | `MODIFIED — UNSTATED` | `architecture.md:41`; `accessibility.md:20-23` | Spec says native `<dialog>` modal; mockups show full-viewport treatment; spec does not address dialog width at desktop; this implicitly downgraded full-bleed to modal-width without documentation. Remains open — no spec addition warranted until desktop detail redesign is in scope |
| Family-color × basemap 32-cell audit matrix (8 families × 2 modes × 2 basemaps) | agent-2 idea 3 closing | `MODIFIED — DOCUMENTED` | `open-questions.md:75-80,83-88` | G7 captures light version; dark mode rolled into G8; only worst-case zoom check specified — per-family/per-mode/per-basemap matrix is not contracted, but the partial scope is explicit |
| Brand mark (26px diamond-in-square) | `sky-atlas-v3` mock; system-poster | `REJECTED-IN-BRAINSTORM` | `architecture.md:31` | Agent-5 counter 7 adopted in v4 ("no brand mark") |
| Dense-data / "Data Atlas" tabular direction | agent-5 counter 6 | `REJECTED-IN-BRAINSTORM` | `voice-and-content.md`; `open-questions.md:22-28` | G1 closed → Position B |
| Field Notebook humanist-serif direction | agent-5 closing | `REJECTED-IN-BRAINSTORM` | `architecture.md:96`; `tokens.md:157` | Position B + system stack adopted |

---

## Summary Counts

| Disposition | Count |
|---|---|
| `CAPTURED` | 55 |
| `DEFERRED-INTENTIONAL` | 11 |
| `DROPPED — DOCUMENTED` | 2 |
| `DROPPED — UNSTATED` | 0 |
| `MODIFIED — DOCUMENTED` | 1 |
| `MODIFIED — UNSTATED` | 2 |
| `REJECTED-IN-BRAINSTORM` | 3 |
| **Total** | **74** |

> One row from the seed matrix (`pushState` on detail-surface entry) was sourced from the phase-4 analysis report rather than a committed brainstorm artifact. It is included as `CAPTURED` because its spec citation exists and removing it would create a gap in the record. The scope bound does not exclude it.

**W5 changes (2026-05-11):** The five `DROPPED — UNSTATED` and two actionable `MODIFIED — UNSTATED` rows from the initial matrix have been resolved:
- Body gradient: `DROPPED — UNSTATED` → `DEFERRED-INTENTIONAL` (flat adopted; gradient deferred v1.1)
- `--accent-secondary/cool` compression: `DROPPED — UNSTATED` → `DROPPED — DOCUMENTED`
- Cluster-pill dot prefix: `DROPPED — UNSTATED` → `DEFERRED-INTENTIONAL` (v1.1 follow-up #475)
- Photo scrim color: `DROPPED — UNSTATED` → `CAPTURED` (token + contract specified)
- Sci-name italic: `DROPPED — UNSTATED` → `CAPTURED` (`<em>` contract; tokens.md + voice-and-content.md)
- Masthead overlay: `MODIFIED — UNSTATED` → `CAPTURED` (full gradient/text/credit contract)
- `--accent-secondary` cross-link: resolved as `DROPPED — DOCUMENTED`

**Remaining open (not resolved in W5):**

1. Detail surface desktop width — `MODIFIED — UNSTATED` — `<dialog>` modal choice implicitly downgraded full-bleed; no spec coverage for desktop dialog width. Defer until desktop detail redesign is in scope.
2. Canvas contrast enforcement gap — `MODIFIED — UNSTATED` — convention documented but no CI enforcement (unlike CSS lint guard). Defer until a canvas-paint CI check is authored.

---

## Maintenance Protocol

**When to update this matrix:**

1. **Per redesign.** When a new major redesign brainstorm is completed, create a new versioned matrix (`coverage-matrix-v5.md`, etc.). Do not mutate this file to cover a different design generation. Each file covers exactly the brainstorm artifacts committed for that version. The `-v4` suffix refers to the v4 mock generation (`sky-atlas-v4.html`), not a document version number.

2. **When a new `DROPPED — UNSTATED` or `MODIFIED — UNSTATED` finding is identified in a future audit.** Add the row to this file, set disposition, and leave the "Captured-in" column blank. Do not wait for the next redesign cycle. The matrix is the permanent record of what was named in the brainstorm and what happened to it.

3. **When a spec is updated to address an UNSTATED finding.** Change the disposition from `DROPPED — UNSTATED` to `CAPTURED` (or `DROPPED — DOCUMENTED` if the decision is to formally drop it), add the spec citation, and add a note recording when the update happened.

**What does not trigger an update:**
- Implementation changes that do not touch spec files
- Token additions that were not in any brainstorm artifact (out of scope per the false-precision guard)
- Test file changes, build config changes

---

## Seed Source

This matrix is itself the durable record of the W5 brainstorm-vs-prod-fidelity audit. Each row encodes the evidence citation (brainstorm artifact, line/section), disposition, and spec citation — this is the audit trail.

Related spec sections that capture the specific findings the audit surfaced:
- Typography contracts (7 previously-unstated contracts): `docs/design/01-spec/tokens.md` §"Typography contracts" (§1–§7)
- Drift-prevention deferred items: `docs/design/01-spec/open-questions.md` §"W5 spec captures (2026-05-11)"
- Full disposition counts and W5 resolution summary: this file's Summary Counts and W5 changes sections above

Issue: [#463](https://github.com/julianken/bird-sight-system/issues/463)
