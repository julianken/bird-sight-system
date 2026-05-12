# Phase 4 — Full Analysis Report: Brainstorm-vs-Prod Fidelity (2026-05-11)

**Date:** 2026-05-11
**Analyst:** Sky Atlas W5 design audit
**Scope:** All committed brainstorm artifacts (`05-archive/brainstorm-mocks/`, `05-archive/design-agents/`) vs. spec files (`docs/design/01-spec/`) as of the W5 branch tip
**Issue:** [#463](https://github.com/julianken/bird-sight-system/issues/463)

---

## Executive Summary

The W5 spec-patch pass resolved all 5 pre-existing `DROPPED — UNSTATED` findings and 1 of 2 `MODIFIED — UNSTATED` findings from the coverage matrix. 74 properties tracked. 55 fully captured. 11 intentionally deferred. 0 silently dropped.

The two remaining open items (canvas contrast CI enforcement, desktop dialog width) are explicitly bounded and not a v1 risk.

---

## Phase Summary

| Phase | Document | Key output |
|---|---|---|
| Phase 0 | _(context packets)_ | Brainstorm artifact inventory; spec file list |
| Phase 1 | `area-2-spec-capture-audit.md` | 74-property discovery set; 5 DROPPED-UNSTATED + 2 MODIFIED-UNSTATED identified |
| Phase 2 | `iterator-4-typography-spec-silence.md` | 7 typography contracts drafted; NOTABLE weight discrepancy identified and resolved |
| Phase 3 | `synthesis-3-drift-prevention.md` | Root-cause taxonomy; structural countermeasures; open items bounded |
| Phase 4 | _(this file)_ | Final report; spec-patch PRs (#460) confirmed to address all findings |

---

## Disposition Summary (post-W5)

| Disposition | Count | Change from initial |
|---|---|---|
| `CAPTURED` | 55 | +6 (5 were DROPPED-UNSTATED, 1 was MODIFIED-UNSTATED) |
| `DEFERRED-INTENTIONAL` | 11 | +1 (body gradient moved from DROPPED-UNSTATED) |
| `DROPPED — DOCUMENTED` | 2 | +1 (`--accent-secondary/cool` compression documented) |
| `DROPPED — UNSTATED` | 0 | -5 (all resolved) |
| `MODIFIED — DOCUMENTED` | 1 | unchanged |
| `MODIFIED — UNSTATED` | 2 | unchanged (canvas contrast, desktop dialog width — bounded) |
| `REJECTED-IN-BRAINSTORM` | 3 | unchanged |
| **Total** | **74** | — |

---

## Notable cross-phase finding: `pushState` on detail-surface entry

This property appears in `coverage-matrix-v4.md` as `CAPTURED` (row 64), sourced from "Analysis report drove this (not in mocks directly)." It was identified during Phase 3 synthesis as a URL-state requirement implied by the dialog-entry pattern but absent from any brainstorm artifact verbatim. It is included in the matrix because its spec citation exists (`url-state.md:24-67`) and removing it would create a gap in the record.

---

## Confidence assessment

**High confidence:**
- All 5 DROPPED-UNSTATED findings resolved with binding spec text and cross-references.
- Font-weight contradiction (NOTABLE 700 vs. 600) identified and resolved within the audit.
- Coverage matrix maintenance protocol established — future audits have a defined process.

**Medium confidence:**
- 7 typography contracts are inescapable in spec but have no automated lint enforcement yet (unlike the `--accent` token lint guard). A future knip/stylelint PR should add weight-token enforcement.

**Known gap:**
- Canvas contrast CI enforcement (row 95) — documented intent, no implementation. Bounded.

---

## Recommendations carried forward

1. Add `--tracking-tight / --tracking-normal / --tracking-wide` to the `:root` CSS block in `tokens.md` (§3 notes they "should be added" — not yet done as of W5).
2. Extend the `--accent` lint guard to catch `font-family:` declarations in component files (§6 recommendation).
3. Canvas contrast CI — author a paint-expression checker when the cluster rendering pipeline stabilizes (post-v1).
4. Quarterly knip re-audit (next: 2026-07-27) — verify `--tracking-*` tokens are referenced by then or add as explicit ignore with rationale.
