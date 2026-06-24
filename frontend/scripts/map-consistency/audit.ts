// frontend/scripts/map-consistency/audit.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { openView } from './camera.js';
import { captureView } from './capture.js';
import { sampleSeedPoints } from './sampler.js';
import { evaluateSample } from './relations.js';
import type { FilterBundle, Recapture, Sample, ViewSnapshot, Verdict, Viewport } from './types.js';

interface Opts { samples: number; scope: string; seed: number; ladder: number[]; viewports: Viewport[]; paceMs: number; baseUrl: string; out: string; }

const OBS_PER_VIEW = 2; // national interstitial + matched hash fetch (worst case)
const CF_SAFE_PER_MIN = 55; // margin under Cloudflare's 60/min/IP
// C4 loop additions (paced like every other view):
const FILTER_BUNDLE_VIEWS = 6; // 1 unfiltered + 2 family + 3 since (first sample only)
const RECAPTURE_VIEWS_PER_SAMPLE = 1; // one extra capture of one camera per sample

function parse(argv: string[]): Opts {
  const get = (f: string, d?: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const seed = Number(get('--seed', '1'));
  const scope = get('--scope', 'US')!;
  return {
    samples: Number(get('--samples', '10')),
    scope, seed,
    ladder: (get('--zoom-ladder', '3,5,7,10,13')!).split(',').map(Number),
    viewports: (get('--viewports', 'desktop,mobile')!).split(',') as Viewport[],
    paceMs: Number(get('--pace-ms', '2500')),
    baseUrl: get('--base-url', 'https://bird-maps.com')!,
    out: get('--out', path.resolve(process.cwd(), 'audit-out', `${stamp}-seed${seed}`))!,
  };
}

function pacingGuard(o: Opts): void {
  const minPace = Math.ceil((60000 * OBS_PER_VIEW) / CF_SAFE_PER_MIN); // ~2182ms
  const obsPerMin = Math.round((60000 / o.paceMs) * OBS_PER_VIEW);
  if (obsPerMin > CF_SAFE_PER_MIN) {
    throw new Error(`Pacing too aggressive: ~${obsPerMin} obs/min > ${CF_SAFE_PER_MIN}/min (Cloudflare 60/min/IP). Raise --pace-ms to >= ${minPace}, or lower --samples.`);
  }
  const ladderViews = o.samples * o.ladder.length * o.viewports.length;
  const extraViews = FILTER_BUNDLE_VIEWS + o.samples * RECAPTURE_VIEWS_PER_SAMPLE + 1; // +1 seed fetch
  const totalViews = ladderViews + extraViews;
  process.stderr.write(`Plan: ${o.samples} samples × ${o.ladder.length} zooms × ${o.viewports.length} viewports = ${ladderViews} ladder views + ${extraViews} (seed + filter bundle + recaptures) = ${totalViews} views; ~${Math.ceil((totalViews * o.paceMs) / 1000)}s wall at ${o.paceMs}ms pace.\n`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Build a family common-name → family-code map from an AGGREGATED observations
 *  response (the z3 seed). Buckets carry AggregatedFamily.{code,name}; the URL
 *  `?family=` param needs the code. Returns an empty map for a non-aggregated body. */
function familyCodeMap(body: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!body || typeof body !== 'object' || (body as { mode?: string }).mode !== 'aggregated') return out;
  const buckets = (body as { buckets?: { families?: { code?: string; name?: string }[] }[] }).buckets ?? [];
  for (const b of buckets) for (const f of b.families ?? []) {
    if (f.name && f.code && !out.has(f.name)) out.set(f.name, f.code);
  }
  return out;
}

async function run(o: Opts): Promise<void> {
  pacingGuard(o);
  await mkdir(o.out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const verdicts: Verdict[] = [];
  const freshSeen = new Set<string>();
  try {
    const context = await browser.newContext();
    // 1. Scope-wide low-zoom fetch → bucket points to sample from.
    const center0 = o.scope === 'US' ? { lng: -97, lat: 39 } : { lng: -111.5, lat: 34 }; // US center; refine per state in C4
    const seedView = await openView(context, o.baseUrl, { scope: o.scope, center: center0, zoom: 3, viewport: 'desktop' });
    const seedSnap = await captureView(seedView.page, seedView.raw, { scope: o.scope, viewport: 'desktop', zoom: 3, center: center0 });
    await seedView.page.close();
    if (seedSnap.network.freshestObservationAt) freshSeen.add(seedSnap.network.freshestObservationAt);
    const scopeTotal = seedSnap.network.total; // scope-wide total for MR-5
    // The `?family=` URL param is a family CODE (e.g. "anatidae"), not the legend's
    // common name — passing a name yields no matching /api/observations fetch and the
    // camera matcher times out. The z3 seed fetch is aggregated, so its buckets carry
    // both AggregatedFamily.code AND .name → build a name→code map once here.
    const familyNameToCode = familyCodeMap(seedView.raw.responseBody);
    const seeds = sampleSeedPoints(seedSnap.network.points, o.samples, o.seed);

    // Helper: capture one view at a camera (paced). A transient fetch hiccup
    // (occasional cold-edge `waitForResponse` timeout) must NOT abort the whole
    // paced run — return an `inconclusive` placeholder (relations skip those) and
    // press on. This mirrors the tile-CDN carve-out already in captureView.
    const capture = async (
      seed: { lng: number; lat: number },
      zoom: number,
      vp: Viewport,
      filters?: { since?: string; family?: string },
    ): Promise<ViewSnapshot> => {
      await sleep(o.paceMs);
      try {
        const { page, raw } = await openView(context, o.baseUrl, { scope: o.scope, center: seed, zoom, viewport: vp, ...(filters ? { filters } : {}) });
        const snap = await captureView(page, raw, { scope: o.scope, viewport: vp, zoom, center: seed });
        await page.close();
        if (snap.network.freshestObservationAt) freshSeen.add(snap.network.freshestObservationAt);
        return snap;
      } catch (e) {
        const reason = `capture failed (${(e as Error).message.split('\n')[0]})`;
        process.stderr.write(`  ⚠ ${vp} z${zoom} @${seed.lng.toFixed(2)},${seed.lat.toFixed(2)}${filters ? ` ${JSON.stringify(filters)}` : ''}: ${reason}\n`);
        return {
          url: '', scope: o.scope, viewport: vp, requestedZoom: zoom, requestedCenter: seed,
          network: { mode: 'unknown', bbox: [0, 0, 0, 0], zoom, truncated: false, freshestObservationAt: null, total: 0, familyCounts: [], points: [], speciesCount: null },
          lede: { text: '', firstInt: null, unit: null }, legend: [], markers: [], consoleErrors: [], consoleWarnings: [],
          inconclusive: { reason },
        };
      }
    };

    const midZoom = o.ladder[Math.floor(o.ladder.length / 2)]!;

    // 2. For each sample, walk the ladder × viewports (paced).
    for (let s = 0; s < seeds.length; s++) {
      const seed = seeds[s]!;
      const views: ViewSnapshot[] = [];
      for (const vp of o.viewports) {
        for (const zoom of o.ladder) {
          views.push(await capture(seed, zoom, vp));
        }
      }

      // Filter bundle (first sample only): unfiltered + top-2 families + since 1d/7d/14d
      // at a single mid-ladder desktop camera. MR-4 reconciles the variants. The
      // legend gives common NAMES; the URL filter needs the family CODE (mapped via
      // the seed fetch). Families with no resolvable code are skipped (can't filter).
      let filterBundle: FilterBundle | undefined;
      if (s === 0) {
        const unfiltered = await capture(seed, midZoom, 'desktop');
        const top2 = [...unfiltered.legend]
          .sort((a, b) => b.count - a.count)
          .map((f) => ({ name: f.family, code: familyNameToCode.get(f.family) }))
          .filter((f): f is { name: string; code: string } => f.code != null)
          .slice(0, 2);
        const byFamily: FilterBundle['byFamily'] = [];
        for (const { name, code } of top2) byFamily.push({ family: name, view: await capture(seed, midZoom, 'desktop', { family: code }) });
        const bySince: FilterBundle['bySince'] = [];
        for (const since of ['1d', '7d', '14d'] as const) bySince.push({ since, view: await capture(seed, midZoom, 'desktop', { since }) });
        filterBundle = { unfiltered, byFamily, bySince };
      }

      // Idempotence: re-capture one camera (mid-ladder desktop) once.
      const ra = views.find((v) => v.viewport === 'desktop' && v.requestedZoom === midZoom) ?? views[0]!;
      const rb = await capture(seed, ra.requestedZoom, 'desktop');
      const recaptures: Recapture[] = [{ a: ra, b: rb }];

      const sample: Sample = { id: `s${s + 1}`, seedPoint: seed, scope: o.scope, views, scopeTotal, recaptures, ...(filterBundle ? { filterBundle } : {}) };
      verdicts.push(...evaluateSample(sample));
      process.stderr.write(`sample ${s + 1}/${seeds.length} done (${verdicts.filter((v) => v.status === 'fail').length} fails so far)\n`);
    }
  } finally {
    await browser.close();
  }

  const fails = verdicts.filter((v) => v.status === 'fail');
  const findings = {
    runMeta: { generatedAtNote: 'stamp set by caller', seed: o.seed, scope: o.scope, samples: o.samples, zoomLadder: o.ladder, viewports: o.viewports, paceMs: o.paceMs, baseUrl: o.baseUrl, freshestRange: [...freshSeen].sort(), command: `--samples ${o.samples} --scope ${o.scope} --seed ${o.seed}` },
    summary: { total: verdicts.length, fails: fails.length, byRelation: Object.fromEntries([...new Set(fails.map((v) => v.relation))].map((r) => [r, fails.filter((v) => v.relation === r).length])) },
    verdicts,
  };
  await writeFile(path.join(o.out, 'findings.json'), JSON.stringify(findings, null, 2));
  process.stderr.write(`\nWrote ${path.join(o.out, 'findings.json')} — ${fails.length} fails / ${verdicts.length} checks.\n`);
}

// ── entry: --probe <url> (C2) OR the full --samples loop ──────────────────────
const argv = process.argv.slice(2);
const pi = argv.indexOf('--probe');
if (pi >= 0 && argv[pi + 1]) {
  const { probe } = await import('./probe.js'); // move C2's probe() into probe.ts in this step
  await probe(argv[pi + 1]!).catch((e) => { console.error(e); process.exit(1); });
} else {
  await run(parse(argv)).catch((e) => { console.error(String(e)); process.exit(1); });
}
