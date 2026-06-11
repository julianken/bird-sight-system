// tools/photo-curation/workflows/score-current.mjs
//
// ┌─ REFERENCE TEMPLATE — NOT STANDALONE-RUNNABLE ────────────────────────────┐
// │ This file is the embedded-logic REFERENCE for the operator-run scoring     │
// │ flow. It is NOT a script you can hand to the Workflow tool verbatim: the   │
// │ Workflow sandbox has NO module `import` and NO filesystem access, so the   │
// │ `import { defaultRubricConfig }` line and any fs use here only work        │
// │ CONCEPTUALLY — they show what the dispatched agents must do, not code the  │
// │ sandbox executes. The CANONICAL, validated run path is                     │
// │ docs/runbooks/photo-curation-scoring.md: the operator runs the CLI         │
// │ `score-prepare`, then dispatches the score Workflow whose agents `Read`    │
// │ the manifest images and apply the rubric via the `photo-judge` agent, then │
// │ runs the CLI `score-commit`. Treat the `agent(...)` calls below as the     │
// │ reference shape for that dispatch, not as a literal runnable program.      │
// └────────────────────────────────────────────────────────────────────────────┘
//
// A Claude Code Workflow-tool reference script (Bug 1, #992). The dispatch is
// driven via the Workflow tool — NEVER via `node`. Token-spending; resumable:
// re-run until the reviewed=0 backlog clears.
//
// CONTRACT: the body uses the Workflow primitives (`agent()`, `parallel()`)
// ONLY. It imports NO `node:fs` and NO `better-sqlite3` — those have no meaning
// in the Workflow sandbox, and mixing them with `agent()` is exactly the bug
// this file replaces (the old hybrid runner ran in neither environment). All
// filesystem + SQLite work happens inside the Node CLI halves the agents shell
// out to:
//
//   photo-curate score-prepare --limit N   → selects reviewed=0, downloads each
//                                             photo, writes ./thumb-cache/<code>.<ext>
//                                             + a manifest JSON, prints its path.
//   <parallel score agents>                → each Reads one imagePath, applies
//                                             the rubric judge prompt, returns
//                                             {speciesCode, fieldMarks, criteria,
//                                              flags, keep, qualityScore, rationale}.
//   photo-curate score-commit results.json → composeReport → upsertScore +
//                                             markReviewed (clears the backlog).
//
// The testable surface is scorePrepare/scoreCommit in ../src/score-orchestration.ts
// (unit-tested with a temp sqlite + a stubbed download). See
// docs/runbooks/photo-curation-scoring.md for the operator flow.
import { defaultRubricConfig } from '@bird-watch/photo-quality';

const LIMIT = Number(process.env.LIMIT ?? 10);

// Scoring judge (#994 lean agent + #969 calibration): the per-photo judge runs
// as the lean `photo-judge` subagent (tools: Read only, short system prompt) —
// NOT the generic Workflow agent (full system prompt + entire tool registry).
// The model defaults to the `opus` alias (NOT a hardcoded id) and is overridable
// via PHOTO_JUDGE_MODEL. #969 calibration (80 photos vs an Opus oracle) picked
// Opus + the field-mark prompt: the cheaper Haiku/Sonnet judges were
// mis-calibrated (Haiku rated an insect 86/100 as a "Bank Swallow"), and the
// production GATE is the judge's DIRECT `keep`, not a composite threshold.
const JUDGE_MODEL = process.env.PHOTO_JUDGE_MODEL ?? 'opus';

// 1) PREPARE — a Bash agent shells out to the Node `score-prepare` half, which
//    selects the next LIMIT reviewed=0 photos, downloads each to ./thumb-cache,
//    and writes a manifest JSON. The agent returns the manifest contents +
//    the manifest path as structured output.
const prepared = await agent(
  `Run \`npx photo-curate score-prepare --limit ${LIMIT}\` in tools/photo-curation.
It prints a human summary line then, on its own final line, the absolute path to a
manifest JSON of shape [{ speciesCode, comName, sciName, family, imagePath, contentHash }].
Read that manifest file and return its parsed contents as \`manifest\` plus the
\`manifestPath\`. If the manifest is empty, return manifest: [] — the backlog is clear.`,
  {
    tools: ['Bash', 'Read'],
    schema: { manifestPath: 'string', manifest: 'object[]' },
  },
);

// 2) SCORE — one judge PER photo, fanned out with parallel(). Each is the lean
//    `photo-judge` subagent (Read-only, short system prompt, `opus` tier) — NOT
//    the generic agent — Reads its own imagePath and applies the SAME field-mark
//    rubric prompt the FakeJudge stands in for in tests, returning the judge's
//    field marks + sub-scores + flags + DIRECT keep/replace decision (the gate)
//    + qualityScore + rationale. The rubric still arrives in the per-call prompt
//    as defaultRubricConfig.judgePrompt (single-sourced in rubric.config.ts — no
//    copy in the agent to drift). No DB, no download — the bytes are already on
//    disk from prepare (and a deterministic gate-fail never reaches here).
const results = await parallel(
  (prepared.manifest ?? []).map(entry => agent(
    `${defaultRubricConfig.judgePrompt}

Read the image at ${entry.imagePath} for ${entry.comName} (${entry.sciName}), family ${entry.family}.
Return structured output: \`fieldMarks\` (the diagnostic field marks), an integer 0–10
for each of the seven criteria (framing, subjectClarity, liveness, naturalness, pose,
background, lighting), a \`flags\` array of any applicable disqualifier strings, \`keep\`
(boolean — the keep/replace gate), \`qualityScore\` (0–100), and a one-sentence
\`rationale\`. Echo the \`speciesCode\` "${entry.speciesCode}" back unchanged.`,
    {
      agentType: 'photo-judge',
      model: JUDGE_MODEL,
      schema: {
        speciesCode: 'string',
        fieldMarks: 'string[]',
        criteria: 'object',
        flags: 'string[]',
        keep: 'boolean',
        qualityScore: 'number',
        rationale: 'string',
      },
    },
  )),
);

// 3) COMMIT — a Bash agent writes the collected results to results.json and
//    shells out to the Node `score-commit` half, which composeReport()s each,
//    upserts the score (role='current'), and marks the species reviewed.
const commit = await agent(
  `Write this JSON to tools/photo-curation/results.json, then run
\`npx photo-curate score-commit results.json\` in tools/photo-curation and return
its summary line:

${JSON.stringify(results, null, 2)}`,
  {
    tools: ['Write', 'Bash'],
    schema: { summary: 'string' },
  },
);

console.log(`[score-current] prepared ${prepared.manifest?.length ?? 0}; committed via score-commit:`);
console.log(commit.summary);
