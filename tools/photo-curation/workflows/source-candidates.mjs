// tools/photo-curation/workflows/source-candidates.mjs
// A REAL Claude Code Workflow-tool script (Bug 1, #992). Run via the Workflow
// tool — NEVER via `node`. Token-spending. Pre-scores a DEEP iNat pool per
// FLAGGED species (current overall < defaultRubricConfig.thresholds.review) so
// Slice 5's deny route can advance to an already-scored alternate instantly.
//
// CONTRACT: the body uses the Workflow primitives (`agent()`, `parallel()`)
// ONLY — NO `node:fs`, NO `better-sqlite3`, NO `@bird-watch/ingestor` fetch.
// All filesystem + SQLite + iNat-fetch work happens inside the Node CLI halves
// the agents shell out to:
//
//   photo-curate source-prepare --pool N    → finds flagged species, fetches +
//                                              downloads a deep iNat pool each,
//                                              inserts candidate rows, writes a
//                                              manifest JSON, prints its path.
//   <parallel score agents>                 → each Reads one candidate imagePath,
//                                              applies the judge prompt, returns
//                                              {speciesCode, inatId, contentHash,
//                                               criteria, flags, rationale}.
//   photo-curate source-commit results.json → composeReport → upsertScore
//                                              (role='candidate').
//
// The testable surface is sourcePrepare/sourceCommit in
// ../src/score-orchestration.ts (unit-tested with a temp sqlite + stubbed
// fetch/download). See docs/runbooks/photo-curation-scoring.md.
import { defaultRubricConfig } from '@bird-watch/photo-quality';

const POOL = Number(process.env.POOL ?? 15);

// Cheaper scoring (#994): the per-candidate judge runs as the lean `photo-judge`
// subagent (tools: Read only, short system prompt) on the `haiku` model tier —
// NOT the generic Workflow agent on the session model. The model defaults to the
// `haiku` alias (NOT a hardcoded id) and is overridable via PHOTO_JUDGE_MODEL so
// #969 calibration can lock the tier (Haiku iff ≥90% agreement, else Sonnet).
const JUDGE_MODEL = process.env.PHOTO_JUDGE_MODEL ?? 'haiku';

// 1) PREPARE — a Bash agent shells out to the Node `source-prepare` half.
const prepared = await agent({
  prompt: `Run \`npx photo-curate source-prepare --pool ${POOL}\` in tools/photo-curation.
It prints a human summary line then, on its own final line, the absolute path to a
manifest JSON of shape
[{ speciesCode, comName, sciName, family, inatId, imagePath, contentHash, attribution, license }].
Read that manifest file and return its parsed contents as \`manifest\` plus the
\`manifestPath\`. If the manifest is empty, return manifest: [] — no flagged species.`,
  tools: ['Bash', 'Read'],
  schema: { manifestPath: 'string', manifest: 'object[]' },
});

// 2) SCORE — one judge PER candidate, fanned out with parallel(). Each is the
//    lean `photo-judge` subagent (Read-only, short system prompt, `haiku` tier)
//    — NOT the generic agent — Reads its own imagePath and applies the rubric
//    prompt, echoing speciesCode, inatId and contentHash back so source-commit
//    can re-key the score row. The rubric still arrives in the per-call prompt as
//    defaultRubricConfig.judgePrompt (single-sourced in rubric.config.ts).
const results = await parallel(
  (prepared.manifest ?? []).map(entry => agent(
    `${defaultRubricConfig.judgePrompt}

Read the candidate image at ${entry.imagePath} for ${entry.comName} (${entry.sciName}),
family ${entry.family}. Return structured output: an integer 0–10 for each of the
seven criteria (framing, subjectClarity, liveness, naturalness, pose, background,
lighting), a \`flags\` array of any applicable disqualifier strings, and a
one-sentence \`rationale\`. Echo back unchanged: speciesCode "${entry.speciesCode}",
inatId ${entry.inatId}, contentHash "${entry.contentHash}".`,
    {
      agentType: 'photo-judge',
      model: JUDGE_MODEL,
      schema: {
        speciesCode: 'string',
        inatId: 'number',
        contentHash: 'string',
        criteria: 'object',
        flags: 'string[]',
        rationale: 'string',
      },
    },
  )),
);

// 3) COMMIT — a Bash agent writes results.json and shells out to source-commit.
const commit = await agent({
  prompt: `Write this JSON to tools/photo-curation/candidate-results.json, then run
\`npx photo-curate source-commit candidate-results.json\` in tools/photo-curation
and return its summary line:

${JSON.stringify(results, null, 2)}`,
  tools: ['Write', 'Bash'],
  schema: { summary: 'string' },
});

console.log(`[source-candidates] sourced ${prepared.manifest?.length ?? 0} candidate(s); committed via source-commit:`);
console.log(commit.summary);
