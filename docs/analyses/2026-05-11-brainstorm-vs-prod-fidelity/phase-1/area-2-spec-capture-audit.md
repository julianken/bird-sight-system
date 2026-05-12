# Phase 1 — Area 2: Spec-Capture Audit

**Date:** 2026-05-11
**Analyst:** Sky Atlas W5 design audit
**Purpose:** Seed the `coverage-matrix-v4.md` discovery set by enumerating every visual property named in committed brainstorm artifacts (`05-archive/brainstorm-mocks/` and `05-archive/design-agents/`) and assigning an initial disposition.

---

## Method

Source artifacts scanned:

- `docs/design/05-archive/brainstorm-mocks/sky-atlas-v3.html`
- `docs/design/05-archive/brainstorm-mocks/sky-atlas-v4.html`
- `docs/design/05-archive/brainstorm-mocks/sky-atlas-system.html`
- `docs/design/05-archive/design-agents/` (agents 1–5, all idea blocks)

Each visual property was extracted with a source citation (artifact + line/section), then checked against the committed spec files (`tokens.md`, `components.md`, `voice-and-content.md`, `accessibility.md`, `motion.md`, `architecture.md`, `url-state.md`) as of the W5 branch tip.

Initial disposition assigned:

- `CAPTURED` if a spec file contained a binding statement matching the property.
- `DROPPED — UNSTATED` if absent from all spec files with no rationale.
- `MODIFIED — UNSTATED` if partially captured but the delta was undocumented.
- `DEFERRED-INTENTIONAL` if an open-question (`G1–G8`) or explicit "v1.1" marker covered it.
- `REJECTED-IN-BRAINSTORM` if agent dissent within the brainstorm process itself rejected the property.
- `DROPPED — DOCUMENTED` if the spec contained a rationale for the omission.

---

## Discovery Set (rows 9–84 → 74 properties after deduplication)

The full 74-row table is reproduced in `coverage-matrix-v4.md`. This document records the evidence trail and initial assignments before W5 spec additions. Five properties entered W5 as `DROPPED — UNSTATED`; two entered as `MODIFIED — UNSTATED`. All seven were resolved during the W5 spec-patch pass (see `coverage-matrix-v4.md` §W5 changes).

### Initial DROPPED — UNSTATED findings (pre-W5)

| Property | Source artifact |
|---|---|
| Body background radial-gradient | `sky-atlas-v4.html:251-264`; `sky-atlas-v3.html:325-340` |
| `--accent-secondary: #1d3b5b` / `--accent-cool: #4a7ba8` | `sky-atlas-system.html:17-18` |
| Cluster pill `::before` colored dot prefix | `sky-atlas-v3.html:373-381`; v4 visual adoption |
| `<Photo>` attribution overlay scrim color (`rgba(0,0,0,0.55)`) | agent-2 idea 6 |
| Italic scientific-name typography | `sky-atlas-v3.html:466,531,752`; system-poster |

### Initial MODIFIED — UNSTATED findings (pre-W5)

| Property | Source artifact | Delta |
|---|---|---|
| `<Photo>` masthead overlay treatment | `sky-atlas-v3.html:496-528` | Full gradient contract unstated |
| Inline-measured contrast extended to canvas | agent-3 idea 1 closing | Enumerated but not enforced |

### Key findings motivating W5 spec additions

1. **Typography silence (7 contracts):** No spec file stated `font-weight`, `font-variant-numeric`, `letter-spacing`, `text-transform`, `--type-*` consumption rules, `font-family` inheritance pattern, or `<em>` sci-name semantic. These were the highest-density gap cluster. Forwarded to Phase 2 iterator-4 for full enumeration.

2. **Photo masthead contract missing:** `<Photo>` components.md entry existed but the overlay gradient (`rgba(0,0,0,0.6)` → `rgba(0,0,0,0.55)` delta from v3 to system poster), species-name text color (`rgba(255,255,255,0.85)`), and credit position were absent. Constituted a full-bleed silent loss on a high-salience surface.

3. **Subtractive accent discipline not traced to source:** The 3-accent system-poster option (`--accent-secondary`, `--accent-cool`, `--color-decision-point`) needed an explicit "one adopted, two dropped" record to prevent future re-introduction.

4. **Cluster dot dropped silently:** The v3 `::before` colored-dot idiom was visually present in v4 mocks but absent from the `<ClusterPill>` spec. Rationale (compositing cost on high-density map canvas) was valid but unrecorded.

---

## Output

→ Delivered to `coverage-matrix-v4.md` as the 74-row discovery set.
→ Typography gap cluster forwarded to `phase-2/iterator-4-typography-spec-silence.md` for contract drafting.
→ W5 spec-patch PRs (#460) addressed all 5 `DROPPED — UNSTATED` and the masthead `MODIFIED — UNSTATED`.
