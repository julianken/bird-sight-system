/**
 * The eleatic Express app factory.
 *
 * `createApp(store, cfg)` builds the read API (+ the single adjudication write)
 * over E2's `EleaticReader` and E1's write store. It writes NO SQL itself — every
 * read delegates to the reader, the one write delegates to `store.recordAdjudication`.
 *
 * Why it takes the `EleaticStore` (not a raw `Database.Database`): `startServer`
 * opens the store via E1's `openStore`, and the store is the natural unit a test
 * seeds (`createApp(openStore(':memory:'), cfg)`). The reader needs the raw handle
 * (`store.db` — E1's documented read-only escape hatch for E2), and the lone write
 * goes through the store's prepared `recordAdjudication`. Zero `@bird-watch/*`
 * imports (the package's git-mv boundary); all imports are `./`/`../` siblings.
 *
 * HTTP-status contract (E4 owns this; E6's drawer relies on it):
 *   • a MISSING / empty required query param → 400
 *   • a well-formed but UNKNOWN run id / row → 404
 * This deliberately diverges from the photo-curation grounding (index.ts:182-187),
 * which returns 400 for an unknown run; eleatic uses 404 for a well-formed unknown id.
 */

import express, { type Express, type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeReader, type FacetFilter, type FacetQuery, type JsonScalar } from '../queries.js';
import { clientConfigSlice, type EleaticConfig } from '../config.js';
import type { EleaticStore } from '../store.js';

// ── Facet `f=` deserialization ────────────────────────────────────────────────
//
// `f=metadata.disagreement:eq:falseKeep` → a single FacetFilter. The query layer
// (E2) owns path VALIDATION (prefix ∈ {scores,metadata}, key ∈ the run's
// discovered keys) and throws on a bad path; this only parses the wire format. A
// structurally malformed `f=` (missing op, unknown op) throws here → mapped to 400.

const FACET_OPS = new Set<FacetFilter['op']>([
  'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'exists',
]);

/** Coerce a string facet value to a JSON scalar: numeric → number, bool → boolean. */
function coerceScalar(raw: string): JsonScalar {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

/**
 * Parse one `path:op:value` (or `path:exists`) facet token into a FacetFilter.
 * Throws on a structurally malformed token (the route maps the throw to 400).
 * `in` takes a comma-separated value list; `exists` takes no value.
 */
export function parseFacet(token: string): FacetFilter {
  const firstColon = token.indexOf(':');
  if (firstColon === -1) throw new Error(`malformed facet (expected path:op[:value]): "${token}"`);
  const path = token.slice(0, firstColon);
  const rest = token.slice(firstColon + 1);
  const secondColon = rest.indexOf(':');
  const opRaw = secondColon === -1 ? rest : rest.slice(0, secondColon);
  const op = opRaw as FacetFilter['op'];
  if (!FACET_OPS.has(op)) throw new Error(`unknown facet op "${opRaw}" in "${token}"`);
  if (path === '') throw new Error(`empty facet path in "${token}"`);

  if (op === 'exists') return { path, op };
  if (secondColon === -1) throw new Error(`facet op "${op}" requires a value in "${token}"`);
  const valueRaw = rest.slice(secondColon + 1);
  if (op === 'in') {
    return { path, op, value: valueRaw.split(',').map(coerceScalar) };
  }
  return { path, op, value: coerceScalar(valueRaw) };
}

/** Narrow an Express-5 query/param value (`string | string[] | undefined`) to a non-empty string. */
function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export function createApp(store: EleaticStore, cfg: EleaticConfig): Express {
  const reader = makeReader(store.db);
  const verdicts = new Set(cfg.verdictVocabulary);
  const app = express();
  app.use(express.json());

  // ── Static UI + bare page routes ──
  // The committed UI lives at the package-root `ui/` (E1 ALSO copies it to
  // `dist/ui/` at build via `cpSync('ui','dist/ui')`, but the source `ui/` is
  // never deleted). `app.{ts,js}` lives in `<root>/{src,dist}/server/`, so a
  // `../../ui` hop reaches the package-root `ui/` in BOTH layouts — the built
  // run (`dist/server/app.js → ../../ui`) and the source/vitest run
  // (`src/server/app.ts → ../../ui`). This keeps the supertest route contracts
  // (run against source) and `eleatic serve` (run against dist) on one path.
  // Use sendFile's `{ root }` form (relative filename) — a bare absolute path
  // trips `send`'s NotFoundError on some paths (see photo-curation index.ts:33-37).
  const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui');
  app.use(express.static(uiDir));

  // The `/config.js` ESM the UI imports — only the client-safe slice (server-only
  // fields like dbPath are dropped by clientConfigSlice).
  app.get('/config.js', (_req: Request, res: Response) => {
    res
      .type('application/javascript')
      .send(`export const config = ${JSON.stringify(clientConfigSlice(cfg))};`);
  });

  // Bare HTML page routes (pages land in E5/E6; routes wired here so `serve` is
  // complete). `index.html` is also served by express.static; the explicit route
  // keeps `GET /` 200 even before a real index page exists (a placeholder ships
  // in this PR's ui/index.html).
  app.get('/', (_req: Request, res: Response) => res.sendFile('index.html', { root: uiDir }));
  app.get('/diff', (_req: Request, res: Response) => res.sendFile('diff.html', { root: uiDir }));
  app.get('/facets', (_req: Request, res: Response) => res.sendFile('facets.html', { root: uiDir }));
  app.get('/trace', (_req: Request, res: Response) => res.sendFile('trace.html', { root: uiDir }));

  // ── Read API ──
  app.get('/api/runs', (_req: Request, res: Response) => {
    res.json({ runs: reader.listRuns() });
  });

  app.get('/api/runs/:id', (req: Request, res: Response) => {
    const id = asString(req.params.id);
    if (id === undefined) return res.status(400).json({ error: 'run id required' });
    const run = reader.getRun(id);
    if (run === undefined) return res.status(404).json({ error: `unknown run: ${id}` });
    return res.json({ run });
  });

  app.get('/api/diff', (req: Request, res: Response) => {
    const a = asString(req.query.a);
    const b = asString(req.query.b);
    if (a === undefined || b === undefined) {
      return res.status(400).json({ error: 'both `a` and `b` run ids are required' });
    }
    if (reader.getRun(a) === undefined) return res.status(404).json({ error: `unknown run: ${a}` });
    if (reader.getRun(b) === undefined) return res.status(404).json({ error: `unknown run: ${b}` });
    return res.json({ diff: reader.diffRuns(a, b) });
  });

  app.get('/api/rows', (req: Request, res: Response) => {
    const run = asString(req.query.run);
    if (run === undefined) return res.status(400).json({ error: 'run required' });
    if (reader.getRun(run) === undefined) return res.status(404).json({ error: `unknown run: ${run}` });

    // No facets / sort: the cheap single-arg path.
    const fParams = ([] as string[]).concat(
      typeof req.query.f === 'string' ? [req.query.f] : Array.isArray(req.query.f) ? (req.query.f as string[]) : [],
    );
    const sortRaw = asString(req.query.sort);
    if (fParams.length === 0 && sortRaw === undefined) {
      return res.json({ rows: reader.getRows(run) });
    }

    // Build a FacetQuery. parseFacet (wire malformed) and the reader's path
    // validation (unknown key / bad prefix) both surface as a 400.
    try {
      const filters: FacetFilter[] = fParams.map(parseFacet);
      const query: FacetQuery = filters.length > 0 ? { filters } : {};
      if (sortRaw !== undefined) {
        const colon = sortRaw.lastIndexOf(':');
        const path = colon === -1 ? sortRaw : sortRaw.slice(0, colon);
        const dir = colon === -1 ? 'asc' : sortRaw.slice(colon + 1);
        if (dir !== 'asc' && dir !== 'desc') throw new Error(`bad sort dir: ${dir}`);
        query.sort = { path, dir };
      }
      return res.json({ rows: reader.facetRows(run, query) });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'bad facet' });
    }
  });

  app.get('/api/row', (req: Request, res: Response) => {
    const run = asString(req.query.run);
    const row = asString(req.query.row);
    if (run === undefined || row === undefined) {
      return res.status(400).json({ error: 'both `run` and `row` are required' });
    }
    const record = reader.getRow(run, row);
    if (record === undefined) return res.status(404).json({ error: `unknown row: ${row} in ${run}` });
    return res.json({ row: record });
  });

  app.get('/api/trends', (req: Request, res: Response) => {
    const metric = asString(req.query.metric);
    if (metric === undefined) return res.status(400).json({ error: 'metric required' });
    return res.json({ trend: reader.metricTrend(metric) });
  });

  // List adjudications + an `isStale` flag per row (the verdict's against_hash vs
  // the row's CURRENT content_hash). Staleness needs a run to resolve a row's
  // current hash; `?run=` is optional — without it, isStale is reported false
  // (no current hash to compare against).
  app.get('/api/adjudications', (req: Request, res: Response) => {
    const run = asString(req.query.run);
    const adjudications = reader.listAdjudications().map((adj) => {
      let isStale = false;
      if (run !== undefined) {
        const row = reader.getRow(run, adj.rowKey);
        if (row?.contentHash !== undefined) isStale = reader.isStale(adj.rowKey, row.contentHash);
      }
      return { ...adj, isStale };
    });
    return res.json({ adjudications });
  });

  // The ONLY write. Captures against_hash from the row's current content_hash at
  // decision time when a `run` (and a matching row) is supplied. Verdict must be
  // in cfg's vocabulary; rowKey is required.
  app.post('/api/adjudications', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      rowKey?: unknown; verdict?: unknown; run?: unknown; note?: unknown;
    };
    const rowKey = asString(body.rowKey);
    const verdict = asString(body.verdict);
    if (rowKey === undefined) return res.status(400).json({ error: 'rowKey required' });
    if (verdict === undefined || !verdicts.has(verdict)) {
      return res.status(400).json({ error: `verdict must be one of: ${cfg.verdictVocabulary.join(', ')}` });
    }
    const run = asString(body.run);
    const note = asString(body.note);
    // Capture the row's current content_hash as the against_hash, so a later edit
    // to the row flips isStale. Omit (no run / no row / no hash) when unresolvable.
    let againstHash: string | undefined;
    if (run !== undefined) {
      const row = reader.getRow(run, rowKey);
      if (row?.contentHash !== undefined) againstHash = row.contentHash;
    }
    store.recordAdjudication({
      rowKey,
      verdict,
      decidedAt: new Date().toISOString(),
      ...(againstHash !== undefined ? { againstHash } : {}),
      ...(note !== undefined ? { note } : {}),
    });
    return res.json({ ok: true });
  });

  return app;
}
