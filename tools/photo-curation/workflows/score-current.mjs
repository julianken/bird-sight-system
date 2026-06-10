// tools/photo-curation/workflows/score-current.mjs
// A REAL Claude Code Workflow-tool script (Bug 1, #992). Run via the Workflow
// tool — NEVER via `node`. Token-spending; resumable: re-run until the
// reviewed=0 backlog clears.
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
//                                             {speciesCode, criteria, flags, rationale}.
//   photo-curate score-commit results.json → composeReport → upsertScore +
//                                             markReviewed (clears the backlog).
//
// The testable surface is scorePrepare/scoreCommit in ../src/score-orchestration.ts
// (unit-tested with a temp sqlite + a stubbed download). See
// docs/runbooks/photo-curation-scoring.md for the operator flow.
import { defaultRubricConfig } from '@bird-watch/photo-quality';

const LIMIT = Number(process.env.LIMIT ?? 10);

// Cheaper scoring (#994): the per-photo judge runs as the lean `photo-judge`
// subagent (tools: Read only, short system prompt) on the `haiku` model tier —
// NOT the generic Workflow agent on the session model. The model defaults to the
// `haiku` alias (NOT a hardcoded id) and is overridable via PHOTO_JUDGE_MODEL so
// #969 calibration can lock the tier (score the labeled sample with Haiku → keep
// iff ≥90% agreement with operator labels, else step up to Sonnet).
const JUDGE_MODEL = process.env.PHOTO_JUDGE_MODEL ?? 'haiku';

// 1) PREPARE — a Bash agent shells out to the Node `score-prepare` half, which
//    selects the next LIMIT reviewed=0 photos, downloads each to ./thumb-cache,
//    and writes a manifest JSON. The agent returns the manifest contents +
//    the manifest path as structured output.
const prepared = await agent({
  prompt: `Run \`npx photo-curate score-prepare --limit ${LIMIT}\` in tools/photo-curation.
It prints a human summary line then, on its own final line, the absolute path to a
manifest JSON of shape [{ speciesCode, comName, sciName, family, imagePath, contentHash }].
Read that manifest file and return its parsed contents as \`manifest\` plus the
\`manifestPath\`. If the manifest is empty, return manifest: [] — the backlog is clear.`,
  tools: ['Bash', 'Read'],
  schema: { manifestPath: 'string', manifest: 'object[]' },
});

// 2) SCORE — one judge PER photo, fanned out with parallel(). Each is the lean
//    `photo-judge` subagent (Read-only, short system prompt, `haiku` tier) — NOT
//    the generic agent — Reads its own imagePath and applies the SAME rubric
//    prompt the FakeJudge stands in for in tests, returning the judge
//    sub-scores/flags/rationale. The rubric still arrives in the per-call prompt
//    as defaultRubricConfig.judgePrompt (single-sourced in rubric.config.ts — no
//    copy in the agent to drift). No DB, no download — the bytes are already on
//    disk from prepare (and a deterministic gate-fail never reaches here).
const results = await parallel(
  (prepared.manifest ?? []).map(entry => agent(
    `${defaultRubricConfig.judgePrompt}

Read the image at ${entry.imagePath} for ${entry.comName} (${entry.sciName}), family ${entry.family}.
Return structured output: an integer 0–10 for each of the seven criteria
(framing, subjectClarity, liveness, naturalness, pose, background, lighting), a
\`flags\` array of any applicable disqualifier strings, and a one-sentence
\`rationale\`. Echo the \`speciesCode\` "${entry.speciesCode}" back unchanged.`,
    {
      agentType: 'photo-judge',
      model: JUDGE_MODEL,
      schema: {
        speciesCode: 'string',
        criteria: 'object',
        flags: 'string[]',
        rationale: 'string',
      },
    },
  )),
);

// 3) COMMIT — a Bash agent writes the collected results to results.json and
//    shells out to the Node `score-commit` half, which composeReport()s each,
//    upserts the score (role='current'), and marks the species reviewed.
const commit = await agent({
  prompt: `Write this JSON to tools/photo-curation/results.json, then run
\`npx photo-curate score-commit results.json\` in tools/photo-curation and return
its summary line:

${JSON.stringify(results, null, 2)}`,
  tools: ['Write', 'Bash'],
  schema: { summary: 'string' },
});

console.log(`[score-current] prepared ${prepared.manifest?.length ?? 0}; committed via score-commit:`);
console.log(commit.summary);
