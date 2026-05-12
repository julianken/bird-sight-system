# Phase 2 — Iterator 4: Typography Spec Silence

**Date:** 2026-05-11
**Analyst:** Sky Atlas W5 design audit
**Input:** Phase 1 finding — "Typography silence (7 contracts)" forwarded from `phase-1/area-2-spec-capture-audit.md`
**Output:** Contract text delivered to `docs/design/01-spec/tokens.md` §Typography contracts (§1–§7)

---

## Purpose

Phase 1 identified that every brainstorm artifact honours a consistent typography system — 7 distinct implicit conventions — but no spec file stated these conventions. This iterator enumerated the 8 raw observations (pre-deduplication), collapsed them to 7 distinct contracts, and drafted binding text for each.

The 8-row raw table:

| # | Observation | Source evidence | Contract delivered |
|---|---|---|---|
| 1 | Scientific names rendered italic in every mock | `sky-atlas-v3.html:466,531,752`; v4 popover; system poster | `tokens.md` §1 — `<em>` UA-default delegation |
| 2 | Meta labels in `text-transform: uppercase; letter-spacing: 1.5px` | `sky-atlas-v3.html:513-520` | `tokens.md` §2 — Label uppercase + tracking |
| 3 | Letter-spacing uses only three values: tight/normal/wide | `sky-atlas-v3.html:461,525,745` | `tokens.md` §3 — Letter-spacing scale |
| 4 | Line-height varies by type tier (1.0–1.5) | `sky-atlas-v3.html:460-461,747` | `tokens.md` §4 — Line-height per type tier |
| 5 | Five weight classes in consistent role assignments | `sky-atlas-v3.html:745`; `sky-atlas-v4.html:273` | `tokens.md` §5 — Font-weight role mapping |
| 6 | No component hardcodes `font-family` — inherits from `body` | Absence of overrides across all mock CSS | `tokens.md` §6 — Font-family token consumption |
| 7 | Numeric content rendered with tabular figures | `sky-atlas-v3.html` count columns | `tokens.md` §7 — `font-variant-numeric` global |
| 8 | Scientific name italic (same as row 1; approach differs: `<em>` vs CSS) | Same sources | Merged into §1; coverage-matrix-v4.md row 94 records from brainstorm-artifact perspective |

**Deduplication note:** Rows 1 and 8 describe the same property from two analytical angles. §1 covers both. Coverage matrix row 94 records the brainstorm-artifact evidence chain separately — this is intentional. The count "7 distinct contracts" excludes the duplicate.

---

## NOTABLE weight finding

During contract drafting for §5 (font-weight role mapping), a cross-spec discrepancy was identified:

- `voice-and-content.md` (pre-W5) stated NOTABLE label at `font-weight: 700`.
- `tokens.md` §5 maps NOTABLE role to `600 / --font-weight-semibold`.

Resolution: `voice-and-content.md` updated to `font-weight: var(--font-weight-semibold)` with an explicit cross-reference to `tokens.md` §5. The spec (§5) is the role-mapping authority; `voice-and-content.md` is the consumer and defers to it. This aligns with the pattern used by all other weight assignments.

---

## Contracts delivered

All seven contracts shipped in `docs/design/01-spec/tokens.md` §Typography contracts as part of PR #460 (W5). Text is authoritative in that file; this document records the evidence chain.

Related:
- `phase-1/area-2-spec-capture-audit.md` (source)
- `phase-3/synthesis-3-drift-prevention.md` (downstream synthesis)
- `coverage-matrix-v4.md` rows 94, 95 (matrix entries for affected properties)
