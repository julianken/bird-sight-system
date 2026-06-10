// tools/photo-curation/workflows/score-current.mjs
// Run via the Workflow tool. Token-spending. Resumable: re-run until the
// reviewed=0 backlog clears. --limit defaults to 10, clamped to [1,100].
//
// This is NOT a vitest target — it wires the real Claude Code agent() judge and
// live fetch. The testable surface is scoreOne/scoreBatch in ../src/sources.ts,
// unit-tested with FakeJudge + a stub download. No @anthropic-ai/sdk, no
// ANTHROPIC_API_KEY: the judge is a Claude Code agent that Reads the local image.
import { openDb, DEFAULT_DB_PATH } from '../dist/db.js';
import { scoreBatch } from '../dist/sources.js';
import { defaultRubricConfig } from '@bird-watch/photo-quality';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const limit = scoreBatch.clampLimit(Number(process.env.LIMIT ?? 10));
const THUMB_DIR = './thumb-cache';
await mkdir(THUMB_DIR, { recursive: true });

// download writes bytes to a local file so the agent can Read it.
const download = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`download ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
};

// The real judge: a Claude Code agent that Reads the local image + applies the
// rubric prompt and returns StructuredOutput {criteria, flags, rationale}.
const judge = {
  async judge(img, ctx, prompt) {
    const path = join(THUMB_DIR, `${ctx.speciesCode}.jpg`);
    await writeFile(path, img.buffer);
    // `agent` is the Workflow-tool dispatch primitive; it Reads `path` and
    // returns the rubric StructuredOutput. No @anthropic-ai/sdk, no API key.
    return await agent({
      prompt: `${prompt}\n\nRead the image at ${path} for ${ctx.comName} (${ctx.sciName}).`,
      schema: { criteria: 'object', flags: 'string[]', rationale: 'string' },
    });
  },
};

const db = openDb(DEFAULT_DB_PATH);
const summary = await scoreBatch(db, limit, { judge, download, config: defaultRubricConfig });
console.log(`[score-current] ${JSON.stringify(summary, null, 2)}`);
db.close();
