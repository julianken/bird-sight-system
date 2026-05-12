# Phase 3 — Synthesis 3: Drift Prevention

**Date:** 2026-05-11
**Analyst:** Sky Atlas W5 design audit
**Input:** Phase 2 iterator-4 findings + Phase 1 full discovery set
**Output:** Drift-prevention recommendations forwarded to `coverage-matrix-v4.md` maintenance protocol and `docs/design/01-spec/` file structure

---

## Purpose

After the W5 spec-patch pass resolved all 5 `DROPPED — UNSTATED` and the primary `MODIFIED — UNSTATED` finding, this synthesis documents: (a) why these silences accumulated, (b) what structural measures prevent recurrence, and (c) what remains deliberately open.

---

## Root-cause taxonomy

The 7 typography contracts and 5 brainstorm-property gaps shared three root causes:

### RC-1: Implicit cross-agent consensus

Agents 1–5 converged on the typography system without naming it. When convergent behavior is never verbalized, it never reaches the spec. Typography especially — weights, line-heights, letter-spacing — was treated as "obvious to any designer" and left implicit. The spec capture process in Phase 1 explicitly searches for consensus-without-verbalization; this is its primary target class.

### RC-2: Partial capture masking gaps

`<Photo>` had a spec entry in `components.md` for its props and state machine. The entry's existence created the appearance of full coverage. But the masthead overlay gradient, species-name text color, and credit position were absent — properties that live "inside" a component that already had a spec entry are easy to miss in a gap audit that only checks for component-name presence.

**Countermeasure:** `coverage-matrix-v4.md` rows track properties, not component entries. A component entry existing is not a proxy for property coverage.

### RC-3: No evidence-chain for deliberate drops

The subtractive accent discipline and cluster-dot drop were genuine product decisions with valid rationale. But neither rationale was recorded at drop-time. The audit exposed both as `DROPPED — UNSTATED`; W5 added the documentation retroactively.

**Countermeasure:** The coverage-matrix maintenance protocol (§Maintenance Protocol in `coverage-matrix-v4.md`) now requires that any `DROPPED — DOCUMENTED` row include a spec citation to the rationale.

---

## Structural measures shipped in W5

1. **`coverage-matrix-v4.md` as permanent record.** The matrix captures every brainstorm-named property's fate. Future redesigns generate a new version file (`coverage-matrix-v5.md`), not a mutation. The audit trail is never overwritten.

2. **§Typography contracts in `tokens.md`.** Seven previously implicit conventions are now binding spec text, making them auditable in future design reviews.

3. **Font-weight role mapping as the authority.** `tokens.md` §5 is the single source of truth for weight assignments. Component files (including `voice-and-content.md`) reference it; they do not independently declare weights.

4. **Drift label taxonomy.** The `drift:*` label set in `CLAUDE.md` provides a structured escalation path for findings that surface outside the brainstorm audit process (e.g., via the nightly workflow or PR-review bot). This complements the spec-capture audit, which is point-in-time.

---

## Remaining open

Two findings from the Phase 1 discovery set were not resolved in W5 and are logged as `MODIFIED — UNSTATED` in `coverage-matrix-v4.md`:

1. **Canvas contrast enforcement gap** (row 95) — inline-measured contrast comments documented but no CI enforcement. Deferred until a canvas-paint CI check is authored.
2. **Detail surface desktop width** (row 97) — `<dialog>` modal choice implicitly downgraded full-bleed; defer until desktop detail redesign is in scope.

Neither is a drift risk for v1 — both are explicitly open in the matrix with rationale.

---

## Related

- `phase-1/area-2-spec-capture-audit.md`
- `phase-2/iterator-4-typography-spec-silence.md`
- `phase-4/analysis-report.md`
- `coverage-matrix-v4.md` §Maintenance Protocol
