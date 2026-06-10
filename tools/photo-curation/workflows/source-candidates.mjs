// tools/photo-curation/workflows/source-candidates.mjs
// Run via the Workflow tool. Token-spending. Pre-scores a DEEP iNat pool (~15)
// per FLAGGED species (current overall < defaultRubricConfig.thresholds.review)
// so Slice 5's deny route can advance to an already-scored alternate instantly.
//
// NOT a vitest target — it wires the real Claude Code agent() judge and live
// fetch/sharp. The testable surface is sourceCandidates in ../src/sources.ts,
// unit-tested with FakeJudge + injected fetch/download/scoreImage. No
// @anthropic-ai/sdk, no ANTHROPIC_API_KEY: the judge Reads the local image.
import { openDb, DEFAULT_DB_PATH } from '../dist/db.js';
import { sourceCandidates } from '../dist/sources.js';
import { scoreImage, defaultRubricConfig } from '@bird-watch/photo-quality';
import { fetchInatCandidates } from '@bird-watch/ingestor';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const POOL = 15; // deep pool per flagged species (same batch cap as scoring)
const THUMB_DIR = './thumb-cache';
await mkdir(THUMB_DIR, { recursive: true });

// download writes bytes to a local file so the agent can Read it.
const download = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`download ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

// The real judge: a Claude Code agent that Reads the local image + applies the
// rubric prompt and returns StructuredOutput {criteria, flags, rationale}.
const judge = {
  async judge(img, ctx, prompt) {
    const path = join(THUMB_DIR, `${ctx.speciesCode}-cand.jpg`);
    await writeFile(path, img.buffer);
    return await agent({
      prompt: `${prompt}\n\nRead the image at ${path} for ${ctx.comName} (${ctx.sciName}).`,
      schema: { criteria: 'object', flags: 'string[]', rationale: 'string' },
    });
  },
};

const db = openDb(DEFAULT_DB_PATH);

// Flagged species: a scored current photo below the review threshold, joined to
// photo_current for the sciName the iNat sourcer keys on.
const flagged = db.prepare(
  `SELECT c.species_code AS speciesCode, c.com_name AS comName,
          c.sci_name AS sciName, c.family AS family
     FROM photo_score s
     JOIN photo_current c ON c.species_code = s.species_code
    WHERE s.role = 'current' AND s.overall < ?
    ORDER BY s.overall ASC`,
).all(defaultRubricConfig.thresholds.review);

const results = [];
for (const sp of flagged) {
  const summary = await sourceCandidates(
    db,
    { speciesCode: sp.speciesCode, sciName: sp.sciName, comName: sp.comName, family: sp.family, limit: POOL },
    {
      fetchInatCandidates,
      download,
      scoreImage,
      judge,
      config: defaultRubricConfig,
      thumbDir: THUMB_DIR,
    },
  );
  results.push(summary);
}
console.log(`[source-candidates] ${JSON.stringify({ flagged: flagged.length, results }, null, 2)}`);
db.close();
