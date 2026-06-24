// frontend/scripts/map-consistency/audit.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { openView } from './camera.js';
import { captureView } from './capture.js';
import { sampleSeedPoints } from './sampler.js';
import { evaluateSample } from './relations.js';
import type { Sample, ViewSnapshot, Verdict, Viewport } from './types.js';

interface Opts { samples: number; scope: string; seed: number; ladder: number[]; viewports: Viewport[]; paceMs: number; baseUrl: string; out: string; }

const OBS_PER_VIEW = 2; // national interstitial + matched hash fetch (worst case)
const CF_SAFE_PER_MIN = 55; // margin under Cloudflare's 60/min/IP

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
  const totalViews = o.samples * o.ladder.length * o.viewports.length;
  process.stderr.write(`Plan: ${o.samples} samples × ${o.ladder.length} zooms × ${o.viewports.length} viewports = ${totalViews} views; ~${Math.ceil((totalViews * o.paceMs) / 1000)}s wall at ${o.paceMs}ms pace.\n`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const seeds = sampleSeedPoints(seedSnap.network.points, o.samples, o.seed);

    // 2. For each sample, walk the ladder × viewports (paced).
    for (let s = 0; s < seeds.length; s++) {
      const views: ViewSnapshot[] = [];
      for (const vp of o.viewports) {
        for (const zoom of o.ladder) {
          await sleep(o.paceMs);
          const { page, raw } = await openView(context, o.baseUrl, { scope: o.scope, center: seeds[s]!, zoom, viewport: vp });
          const snap = await captureView(page, raw, { scope: o.scope, viewport: vp, zoom, center: seeds[s]! });
          await page.close();
          if (snap.network.freshestObservationAt) freshSeen.add(snap.network.freshestObservationAt);
          views.push(snap);
        }
      }
      const sample: Sample = { id: `s${s + 1}`, seedPoint: seeds[s]!, scope: o.scope, views };
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
