# Photo-scorer calibration (#969)

**Date:** 2026-06-10 · **Outcome:** the production judge is **Opus**, using a
**field-mark-aware** prompt, with its **direct keep/replace decision as the
gate**. The rubric's seven criteria are retained for review-UI ranking; the
composite/thresholds/caps become **advisory**, not the gate. The #994
deterministic pre-filter **stays** (a cheap reject before any vision call).

## Method

A curated **80-photo** sample (known-good ↔ known-bad, including dead, in-hand,
specimen, distant, captive/feeder) was scored under five judge configurations and
compared against an **Opus "premium field-guide editor" oracle** that labeled
each photo keep/replace. "Agreement" below is the share of the 80 photos where a
configuration's keep/replace call matched the oracle.

## Frontier

| # | Configuration | Agreement |
|---|---|---|
| 1 | Haiku — single holistic composite | 82.5% |
| 2 | Haiku — distributed (per-criterion decomposition) | 81% |
| 3 | Sonnet — single composite | 86.3% |
| 4 | Sonnet — distributed | 83.8% |
| 5 | Sonnet — field-mark escalation | 87.5% |
| — | **Opus — field-mark prompt + direct keep gate** | **chosen ceiling** |

## Findings

1. **The cheap Haiku gate is too weak.** It misreads subjects entirely — it rated
   an insect **86/100 as a "Bank Swallow."** At 82.5% it sits well below a usable
   gate, and the failures are not near-misses but category errors (non-birds,
   wrong family) that a guide-photo gate must never pass.
2. **Decomposition never beats a single composite.** Splitting the judgment into
   per-criterion sub-calls (rows 2 and 4) *lowered* agreement for both Haiku
   (82.5%→81%) and Sonnet (86.3%→83.8%). Distributing the work fragments the
   holistic judgment without adding signal — more calls, worse calibration.
3. **Sonnet's holistic verdict is mis-calibrated, but its criteria are good.** The
   per-criterion 0–10 scores Sonnet returns are sound for ranking; its overall
   keep/replace call is not reliable enough to gate on. This is why the criteria
   survive (as advisory ranking) while the composite stops being the gate.
4. **Field-mark framing supplies the missing species-aware reasoning.** Making the
   judge first name the species' diagnostic field marks — then decide whether
   *this* photo shows enough of them — recovers the ID-first reasoning the holistic
   judges lacked (row 5: Sonnet 86.3%→87.5%). The same framing on Opus is the
   chosen production judge.

## Decision

- **Judge:** Opus (`photo-judge` subagent, `tools: Read`, `model: opus`).
- **Prompt:** field-mark-aware — Step 1 name the diagnostic marks, Step 2 the
  seven 0–10 criteria, Step 3 disqualifier flags, Step 4 a direct keep/replace
  decision + a 0–100 qualityScore. Single-sourced in
  `packages/photo-quality/src/rubric.config.ts` (`rubricVersion` 0.1.0 → 0.2.0,
  which invalidates content-hash-keyed cached scores so the backlog re-scores).
- **Gate:** the judge's `keep`. Downstream "needs replacement" = `keep === false`,
  **not** `overall < threshold`. The criteria/composite/caps/thresholds remain for
  review-UI ranking and to choose which flagged species get sourced alternates.
- **Unchanged:** the #994 deterministic pre-filter still gates a free reject
  (tiny/blurry/wrong-aspect) before any Opus call; a gate-fail is persisted as
  `keep: false` with no judge dispatch.
