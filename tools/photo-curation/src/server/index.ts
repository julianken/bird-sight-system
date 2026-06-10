import express, { type Express, type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import {
  listOverview, getSwapView, writeDecision, denyAndAdvance,
  type SortMode, type FilterMode,
} from './queries.js';

// NOTE: the Express server is plain Node — it CANNOT dispatch a Claude Code
// agent, so it never scores a photo. All scoring lives in the `source-candidates`
// workflow, which pre-scores a DEEP candidate pool ahead of the review session.
// Deny advances to the next already-scored alternate from that pool, or — when
// the pool is exhausted — queues a re-source for the next `source-candidates` run.

const VALID_SORTS: SortMode[] = ['worst-first', 'best-first', 'has-better-candidate', 'recently-scored'];
const VALID_FILTERS: FilterMode[] = ['all', 'flagged', 'dead-sick', 'distant', 'in-hand', 'soft', 'marked-for-swap', 'unscored'];

export function createServer(db: Database.Database): Express {
  const app = express();
  app.use(express.json());

  // ── Static screens ──
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
  app.use(express.static(publicDir));
  // Screen 2 is one HTML file; the :code is read client-side from the path.
  // Use sendFile's { root } option (relative filename) — the canonical Express 5
  // form; passing a bare absolute path trips `send`'s NotFoundError on some paths.
  app.get('/swap/:code', (_req: Request, res: Response) => {
    res.sendFile('swap.html', { root: publicDir });
  });

  // ── JSON API ──
  app.get('/api/overview', (req: Request, res: Response) => {
    const sort = (req.query.sort as SortMode) ?? 'worst-first';
    const filter = (req.query.filter as FilterMode) ?? 'all';
    if (!VALID_SORTS.includes(sort)) return res.status(400).json({ error: `bad sort: ${sort}` });
    if (!VALID_FILTERS.includes(filter)) return res.status(400).json({ error: `bad filter: ${filter}` });
    const rows = listOverview(db, { sort, filter });
    const staged = db.prepare(`SELECT COUNT(*) AS c FROM photo_decision WHERE action='approve' AND applied=0`).get() as { c: number };
    return res.json({ rows, stagedApproved: staged.c, sort, filter });
  });

  app.get('/api/swap/:code', (req: Request, res: Response) => {
    // Express 5 types params values as `string | string[] | undefined`; a single
    // named segment is always a string at runtime, but narrow it for strict TS.
    const code = req.params.code;
    if (typeof code !== 'string' || !code) return res.status(400).json({ error: 'species code required' });
    const view = getSwapView(db, code);
    if (!view) return res.status(404).json({ error: `unknown species: ${code}` });
    return res.json(view);
  });

  app.post('/api/decision', (req: Request, res: Response) => {
    const { speciesCode, action, chosenCandidateId } = req.body ?? {};
    if (typeof speciesCode !== 'string' || !speciesCode) return res.status(400).json({ error: 'speciesCode required' });
    if (action !== 'approve' && action !== 'keep' && action !== 'pending') {
      return res.status(400).json({ error: `bad action: ${action}` }); // deny goes to /api/deny
    }
    // An approve MUST carry a chosen candidate's inat id. Enforce server-side so
    // a missing/null chosenCandidateId is rejected (400) independent of whether
    // the UI disabled the Approve button — a null approve would silently store
    // chosen_candidate_id = NULL and defeat the swap.
    if (action === 'approve' && typeof chosenCandidateId !== 'number') {
      return res.status(400).json({ error: 'approve requires chosenCandidateId' });
    }
    writeDecision(db, {
      speciesCode, action,
      ...(typeof chosenCandidateId === 'number' ? { chosenCandidateId } : {}),
    });
    return res.json({ ok: true });
  });

  app.post('/api/deny', (req: Request, res: Response) => {
    const { speciesCode, reason, tags, excludeIds } = req.body ?? {};
    if (typeof speciesCode !== 'string' || !speciesCode) return res.status(400).json({ error: 'speciesCode required' });
    if (typeof reason !== 'string') return res.status(400).json({ error: 'reason required' });

    // Part 5a's denyAndAdvance does it all in one call: records the deny
    // (photo_decision action='deny' + deny_reason + deny_tags_json), excludes the
    // shown candidate(s) (excludeIds → photo_candidate.excluded=1), and returns the
    // next ALREADY-SCORED alternate from the pre-scored pool as `next`. The server
    // does NOT score — when no scored alternate remains, denyAndAdvance sets
    // photo_decision.resource_requested=1 and returns resourceRequested=true so the
    // UI shows "re-source queued — run `source-candidates` then refresh."
    const result = denyAndAdvance(db, {
      speciesCode,
      reason,
      tags: Array.isArray(tags) ? (tags as string[]) : [],
      excludeIds: Array.isArray(excludeIds) ? (excludeIds as number[]) : [],
    });
    return res.json({ proposed: result.next, resourceQueued: result.resourceRequested });
  });

  return app;
}
