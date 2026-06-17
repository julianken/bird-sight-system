/**
 * replay-viewbox — open & diff N viewbox links (epic #1238, child C3 / #1241).
 *
 * Given N viewbox links (the `?state=…&since=…#map=…&v=…` links C2's "Copy link
 * to this view" button emits), this tool opens each link at its CAPTURED
 * viewport + camera, captures the live `/api/observations` request + response,
 * screenshots the rendered map, and emits a side-by-side diff. It is the
 * consumer that turns "here are 3 links that disagree" into a concrete,
 * inspectable comparison — the mechanism for reproducing a multi-view DATA
 * INCONSISTENCY (different `mode`, bucket/observation counts, species totals).
 *
 * ─ Why this lives in frontend/scripts/ (NOT frontend/e2e/) ───────────────────
 * It is an operator tool with no pass/fail assertions, so it must NOT sit under
 * `frontend/e2e/` where `playwright test` would try to run it as a spec (and
 * fail the `e2e` gate for having no assertions). It uses the Playwright
 * `chromium.launch()` + `browser.newContext(...)` API, importing `chromium`
 * from `@playwright/test` (which re-exports it) — never a bare `playwright`
 * package (undeclared in frontend/package.json → knip unlisted-dependency).
 * Because `frontend/scripts/**` is outside the frontend `src`-only graph, knip
 * reports this file as unused; `knip.ts` carries a dated ignore for it.
 *
 * ─ Why the DEV SERVER, never the preview build ──────────────────────────────
 * `window.__birdMap` (the live MapLibre instance the tool drives via `jumpTo`)
 * is assigned in MapCanvas.tsx ONLY when `import.meta.env.MODE !== 'production'`
 * — present on the Vite dev server (`MODE=development`), absent in the
 * preview/prod build. The tool owns its base URL (defaults to the dev port),
 * registers NO `/api/observations` stub (it wants the REAL proxied response the
 * dev server forwards to the read-api), and fails loudly with a clear message
 * if `__birdMap` is absent (you pointed it at the wrong build).
 *
 * ─ Usage ────────────────────────────────────────────────────────────────────
 *   # 1. Start the dev server (with the read-api reachable at /api):
 *   npm run dev -w @bird-watch/frontend            # serves on :5173
 *   #    (and a seeded read-api on :8787 — see frontend/scripts/README.md)
 *
 *   # 2. Run the tool against N links (label= prefix optional):
 *   npm run -w @bird-watch/frontend replay:viewbox -- \
 *     'desktop=http://localhost:5173/?state=US-AZ#map=11.000/33.45000/-112.07000&v=1440x900@1' \
 *     'mobile=http://localhost:5173/?state=US-AZ#map=11.000/33.45000/-112.07000&v=390x844@2'
 *
 *   # …or from a file (one `[label=]<url>` per line; blank lines / # comments ok):
 *   npm run -w @bird-watch/frontend replay:viewbox -- --links-file ./links.txt
 *
 * Flags: --base <url> (override the dev base, default http://localhost:5173 or
 * $REPLAY_BASE_URL), --out <dir> (override the run dir, default
 * ./replay-out/<timestamp>), --headed (show the browser).
 *
 * Output (a run dir): `<label>-<WxH>.png` per link + `replay-report.json`
 * (`[{ label, url, requestUrl, responseBody, screenshotPath }]`) + a generated
 * `replay-diff.md` that places the views side by side and highlights response
 * deltas (mode, counts, species totals). JSON-first so the diff is
 * machine-comparable and git-diffable.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';

import { decodeViewbox, type ViewboxCamera } from '@/state/viewbox-link.js';
import type { ObservationsResponse } from '@bird-watch/shared-types';

const DEFAULT_BASE_URL = process.env.REPLAY_BASE_URL ?? 'http://localhost:5173';

// ─────────────────────────────────────────────────────────────────────────────
// CLI parsing
// ─────────────────────────────────────────────────────────────────────────────

interface CliInput {
  /** A labelled link: `{ label, url }`, url already the full original link. */
  label: string;
  url: string;
}

interface CliOptions {
  links: CliInput[];
  baseUrl: string;
  outDir: string;
  headed: boolean;
}

/** Split a `label=<url>` token into its parts; default label `view-<n>`. */
function parseLinkToken(token: string, index: number): CliInput {
  // A link is `…#map=…` — the FIRST '=' belongs to a `label=` prefix ONLY when
  // what precedes it has no scheme/`?`/`#`/`/` (a bare identifier). Otherwise the
  // token is a raw URL and the first '=' is part of a query/hash pair.
  const eq = token.indexOf('=');
  if (eq > 0) {
    const maybeLabel = token.slice(0, eq);
    if (/^[A-Za-z0-9._-]+$/.test(maybeLabel)) {
      return { label: maybeLabel, url: token.slice(eq + 1) };
    }
  }
  return { label: `view-${index + 1}`, url: token };
}

async function readLinksFile(file: string): Promise<string[]> {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

async function parseArgs(argv: string[]): Promise<CliOptions> {
  const rawLinks: string[] = [];
  let baseUrl = DEFAULT_BASE_URL;
  let outDir: string | undefined;
  let headed = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--base') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--base requires a URL argument');
      baseUrl = next;
    } else if (arg === '--out') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--out requires a directory argument');
      outDir = next;
    } else if (arg === '--links-file') {
      const next = argv[++i];
      if (next === undefined) throw new Error('--links-file requires a path argument');
      rawLinks.push(...(await readLinksFile(next)));
    } else if (arg === '--headed') {
      headed = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      rawLinks.push(arg);
    }
  }

  if (rawLinks.length === 0) {
    throw new Error(
      'No links given. Pass one or more `[label=]<url>` arguments, or ' +
        '--links-file <path>. See the header of this file for usage.',
    );
  }

  const links = rawLinks.map(parseLinkToken);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    links,
    baseUrl: baseUrl.replace(/\/$/, ''),
    outDir: outDir ?? path.resolve(process.cwd(), 'replay-out', stamp),
    headed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Link → dev-server target. The tool OWNS the base URL: a link copied from
// prod (bird-maps.com) still replays against the local dev server, because only
// the dev build exposes `__birdMap` and proxies /api to a real read-api. We
// keep the link's path + query + hash (scope, since, #map=, &v=) and swap only
// the origin.
// ─────────────────────────────────────────────────────────────────────────────

function toDevTarget(link: string, baseUrl: string): { target: string; hash: string } {
  // Tolerate a relative link (`/?state=…#map=…`) as well as an absolute one.
  const parsed = new URL(link, baseUrl);
  const hash = parsed.hash; // includes the leading '#'
  const target = `${baseUrl}${parsed.pathname}${parsed.search}${hash}`;
  return { target, hash };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response summary + delta — PURE, so the diff is reasoned about (and could be
// unit-tested) independently of the browser. Summarizes either response mode
// into comparable scalars; `diffSummaries` highlights the deltas that matter
// for a multi-view inconsistency (mode flip, count/species drift).
// ─────────────────────────────────────────────────────────────────────────────

interface ResponseSummary {
  mode: ObservationsResponse['mode'] | 'unknown';
  /** Total observations: aggregated → Σ bucket.count; observations → data.length. */
  observationCount: number;
  /** Distinct species (observations mode) — null in aggregated mode (buckets
   *  carry per-cell speciesCount that overlaps across cells, so a single global
   *  distinct count is not derivable without the raw codes). */
  distinctSpecies: number | null;
  /** Aggregated mode only: number of grid buckets; null otherwise. */
  bucketCount: number | null;
  /** Distinct family codes present (both modes, best-effort). */
  distinctFamilies: number;
  truncated: boolean;
  freshestObservationAt: string | null;
}

function summarizeResponse(body: unknown): ResponseSummary {
  const empty: ResponseSummary = {
    mode: 'unknown',
    observationCount: 0,
    distinctSpecies: null,
    bucketCount: null,
    distinctFamilies: 0,
    truncated: false,
    freshestObservationAt: null,
  };
  if (body === null || typeof body !== 'object' || !('mode' in body)) return empty;
  const resp = body as ObservationsResponse;

  if (resp.mode === 'observations') {
    const species = new Set<string>();
    const families = new Set<string>();
    for (const obs of resp.data) {
      species.add(obs.speciesCode);
      if (obs.familyCode) families.add(obs.familyCode);
    }
    return {
      mode: 'observations',
      observationCount: resp.data.length,
      distinctSpecies: species.size,
      bucketCount: null,
      distinctFamilies: families.size,
      truncated: resp.meta.truncated === true,
      freshestObservationAt: resp.meta.freshestObservationAt,
    };
  }

  // aggregated
  const families = new Set<string>();
  let observationCount = 0;
  for (const bucket of resp.buckets) {
    observationCount += bucket.count;
    for (const fam of bucket.families) families.add(fam.code);
  }
  return {
    mode: 'aggregated',
    observationCount,
    distinctSpecies: null,
    bucketCount: resp.buckets.length,
    distinctFamilies: families.size,
    truncated: resp.meta.truncated === true,
    freshestObservationAt: resp.meta.freshestObservationAt,
  };
}

interface ReplayRecord {
  label: string;
  url: string;
  requestUrl: string;
  responseBody: unknown;
  screenshotPath: string;
  // Derived (handy for the diff; not required by the AC's JSON shape but
  // additive — the four AC-named keys above are all present).
  viewport: { width: number; height: number; dpr: number };
  summary: ResponseSummary;
}

/** Render the side-by-side diff as Markdown: one column per link, a metrics
 *  table, and a plain-language callout of the deltas that signal an
 *  inconsistency (mode flip, observation/species/family drift). */
function renderDiffMarkdown(records: ReplayRecord[]): string {
  const lines: string[] = [];
  lines.push('# replay-viewbox diff', '');
  lines.push(`Generated: ${new Date().toISOString()}`, '');
  lines.push(`Comparing **${records.length}** view(s).`, '');

  // Per-view header block.
  for (const r of records) {
    lines.push(`## ${r.label}`, '');
    lines.push(`- URL: \`${r.url}\``);
    lines.push(`- Request: \`${r.requestUrl}\``);
    lines.push(
      `- Viewport: ${r.viewport.width}×${r.viewport.height} @${r.viewport.dpr}`,
    );
    lines.push(`- Screenshot: \`${r.screenshotPath}\``);
    lines.push(`- ![${r.label}](${r.screenshotPath})`, '');
  }

  // Metrics table — one row per metric, one column per view, for at-a-glance
  // side-by-side comparison.
  const header = ['metric', ...records.map((r) => r.label)];
  const sep = header.map(() => '---');
  const rows: string[][] = [
    ['mode', ...records.map((r) => r.summary.mode)],
    ['observations', ...records.map((r) => String(r.summary.observationCount))],
    [
      'buckets',
      ...records.map((r) =>
        r.summary.bucketCount === null ? '—' : String(r.summary.bucketCount),
      ),
    ],
    [
      'distinct species',
      ...records.map((r) =>
        r.summary.distinctSpecies === null ? '—' : String(r.summary.distinctSpecies),
      ),
    ],
    ['distinct families', ...records.map((r) => String(r.summary.distinctFamilies))],
    ['truncated', ...records.map((r) => (r.summary.truncated ? 'YES' : 'no'))],
    [
      'freshest',
      ...records.map((r) => r.summary.freshestObservationAt ?? '—'),
    ],
  ];
  lines.push('## Side-by-side', '');
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${sep.join(' | ')} |`);
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  lines.push('');

  // Delta callout — compare the first view to the rest; surface what disagrees.
  lines.push('## Deltas', '');
  if (records.length < 2) {
    lines.push('_Only one view — nothing to compare._', '');
    return lines.join('\n');
  }
  const base = records[0];
  if (base === undefined) return lines.join('\n');
  const deltas: string[] = [];
  for (let i = 1; i < records.length; i++) {
    const other = records[i];
    if (other === undefined) continue;
    const pair = `${base.label} → ${other.label}`;
    if (base.summary.mode !== other.summary.mode) {
      deltas.push(
        `- **MODE FLIP** (${pair}): \`${base.summary.mode}\` vs \`${other.summary.mode}\` ` +
          '— the two views are served by different code paths; a count comparison ' +
          'below is apples-to-oranges and is itself the headline inconsistency.',
      );
    }
    if (base.summary.observationCount !== other.summary.observationCount) {
      deltas.push(
        `- observations differ (${pair}): ${base.summary.observationCount} vs ` +
          `${other.summary.observationCount} (Δ ${
            other.summary.observationCount - base.summary.observationCount
          }).`,
      );
    }
    if (
      base.summary.distinctSpecies !== null &&
      other.summary.distinctSpecies !== null &&
      base.summary.distinctSpecies !== other.summary.distinctSpecies
    ) {
      deltas.push(
        `- distinct species differ (${pair}): ${base.summary.distinctSpecies} vs ` +
          `${other.summary.distinctSpecies}.`,
      );
    }
    if (base.summary.distinctFamilies !== other.summary.distinctFamilies) {
      deltas.push(
        `- distinct families differ (${pair}): ${base.summary.distinctFamilies} vs ` +
          `${other.summary.distinctFamilies}.`,
      );
    }
    if (base.summary.truncated !== other.summary.truncated) {
      deltas.push(
        `- truncation differs (${pair}): ${base.summary.truncated} vs ` +
          `${other.summary.truncated} — one view hit the row brake; counts below it ` +
          'are a floor, not a total.',
      );
    }
  }
  if (deltas.length === 0) {
    lines.push('_No metric deltas across views — the responses agree on the ' +
      'summarized scalars._', '');
  } else {
    lines.push(...deltas, '');
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser driving
// ─────────────────────────────────────────────────────────────────────────────

/** `window.__birdMap` shape we drive — a subset of the MapLibre Map surface. */
interface BirdMapHook {
  jumpTo: (opts: {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
  }) => void;
  once: (ev: string, cb: () => void) => void;
}

/**
 * Drive one link in its own page. Asserts `__birdMap` is present (dev build),
 * `jumpTo`s the captured camera, latches the post-jump `idle`, captures the
 * live `/api/observations` request+response, and screenshots. Throws a clear
 * error if the dev-build hook is missing.
 */
async function replayOne(
  context: BrowserContext,
  link: CliInput,
  camera: ViewboxCamera,
  viewport: { width: number; height: number; dpr: number },
  baseUrl: string,
  outDir: string,
): Promise<ReplayRecord> {
  const page = await context.newPage();
  // Size THIS page to the link's captured viewport. DPR is fixed at context
  // creation (deviceScaleFactor, set by the caller per distinct DPR); the
  // width/height are page-level, so they are set here per link.
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const { target } = toDevTarget(link.url, baseUrl);

  // Collect EVERY /api/observations response across the whole flow (the cold
  // initial deep-link fetch AND the camera-driven one). A `?state=…` deep link
  // fires an initial fetch at the framing zoom BEFORE our jumpTo lands; we want
  // the response for the camera WE set, which is the LAST one after the jump
  // settles — so we buffer them all (url + parsed body) and pick the last below,
  // rather than racing a single waitForResponse that would catch the cold-load
  // fetch. Bodies are read eagerly inside the handler because a Response body is
  // only retrievable while the response is live.
  const observationResponses: Array<{ requestUrl: string; body: unknown }> = [];
  page.on('response', (resp) => {
    if (!resp.url().includes('/api/observations')) return;
    const requestUrl = resp.request().url();
    void resp
      .json()
      .then((body: unknown) => observationResponses.push({ requestUrl, body }))
      .catch(async () => {
        // Non-JSON (e.g. a proxy 502 HTML page) — record the text so the report
        // still explains what happened rather than dropping the response.
        const body = {
          error: 'non-JSON response',
          status: resp.status(),
          text: await resp.text().catch(() => '<unreadable>'),
        };
        observationResponses.push({ requestUrl, body });
      });
  });

  await page.goto(target, { waitUntil: 'domcontentloaded' });

  // Wait for the map canvas to mount (the visible render surface).
  await page
    .locator('[data-testid="map-canvas"]')
    .waitFor({ state: 'visible', timeout: 15_000 });

  // Assert the dev-build hook is present — fail LOUDLY if not (AC 2).
  const hookReady = await page
    .waitForFunction(
      () => typeof (window as { __birdMap?: unknown }).__birdMap !== 'undefined',
      undefined,
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!hookReady) {
    throw new Error(
      `[${link.label}] window.__birdMap was never exposed at ${target}.\n` +
        'This tool MUST drive the Vite DEV server (MODE=development), where ' +
        'MapCanvas.tsx assigns __birdMap. It is absent in the preview/prod ' +
        'build. Start it with `npm run dev -w @bird-watch/frontend` (default ' +
        `base ${baseUrl}) and re-run, or pass --base <dev-url>. ` +
        '(If __birdMap is present but slow, the map may have failed to reach ' +
        'WebGL `load` — check the dev server console.)',
    );
  }

  // Drive the captured camera via jumpTo (synchronous moveend — no animation
  // interpolation, the proven pattern over flyTo({duration:0})). Install a
  // one-shot idle latch first so we wait for the NEXT idle after this jump.
  await page.evaluate(
    (cam: ViewboxCamera) => {
      const w = window as { __birdMap?: BirdMapHook; __replayIdleSince?: number };
      const map = w.__birdMap;
      if (map === undefined) throw new Error('__birdMap vanished after the readiness check');
      w.__replayIdleSince = 0;
      map.once('idle', () => {
        (window as { __replayIdleSince?: number }).__replayIdleSince = Date.now();
      });
      map.jumpTo({
        center: [cam.lng, cam.lat],
        zoom: cam.zoom,
        bearing: cam.bearing ?? 0,
        pitch: cam.pitch ?? 0,
      });
    },
    camera,
  );

  // Snapshot how many observations responses arrived BEFORE the jump (the
  // cold-load fetches). After the jump we want a response that landed AFTER this
  // point — the camera-driven one.
  const preJumpCount = observationResponses.length;

  // Deterministically latch the post-jump idle (the same event App's
  // onViewportChange listens to). Best-effort — a stalled idle still proceeds to
  // capture rather than hang the whole run.
  await page
    .waitForFunction(
      () => {
        const since = (window as { __replayIdleSince?: number }).__replayIdleSince;
        return typeof since === 'number' && since > 0;
      },
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);

  // Wait for the camera-driven /api/observations response to arrive (the app
  // debounces the bbox refetch off `idle`, so it lands shortly after the jump).
  // Poll the Node-side buffer for a response that landed after `preJumpCount`.
  // Best-effort: if the new camera maps to a byte-identical request, the dedup
  // in client.ts may coalesce it (no new network event) — then no post-jump
  // response arrives and we fall through to the latest captured response, still
  // the live body for this view.
  const deadline = Date.now() + 8_000;
  while (observationResponses.length <= preJumpCount && Date.now() < deadline) {
    await page.waitForTimeout(100);
  }

  // Capture the LIVE proxied observations response (no stub registered). Prefer
  // the LAST response (the settled, camera-driven one); if none arrived at all
  // the run is degenerate — record an explicit sentinel rather than crash.
  const captured = observationResponses.at(-1);
  const requestUrl = captured?.requestUrl ?? '<no /api/observations request observed>';
  const responseBody: unknown =
    captured?.body ?? { error: 'no /api/observations response observed for this view' };

  const screenshotName = `${link.label}-${viewport.width}x${viewport.height}.png`;
  const screenshotPath = path.join(outDir, screenshotName);
  await page.screenshot({ path: screenshotPath });

  await page.close();

  return {
    label: link.label,
    url: link.url,
    requestUrl,
    responseBody,
    // store a RELATIVE screenshot path in the report/diff so the run dir is
    // portable (the .md renders the image next to the json).
    screenshotPath: screenshotName,
    viewport,
    summary: summarizeResponse(responseBody),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = await parseArgs(process.argv.slice(2));
  await mkdir(opts.outDir, { recursive: true });

  // Decode every link up front so a malformed one fails before we launch a
  // browser. decodeViewbox is TOTAL — `null` means no recoverable camera.
  const decoded = opts.links.map((link) => {
    const { hash } = toDevTarget(link.url, opts.baseUrl);
    const result = decodeViewbox(hash);
    if (result === null) {
      throw new Error(
        `[${link.label}] no #map= camera in link (decodeViewbox returned null): ${link.url}\n` +
          'A replayable link must carry a `#map=<zoom>/<lat>/<lng>…` hash ' +
          "(the output of C2's \"Copy link to this view\").",
      );
    }
    // Viewport falls back to a desktop default if the link omits `&v=` (an
    // older / hand-written link); DPR defaults to 1.
    const viewport = result.viewport ?? { w: 1440, h: 900, dpr: 1 };
    return { link, camera: result.camera, viewport };
  });

  console.log(`replay-viewbox: ${decoded.length} link(s) → ${opts.outDir}`);
  console.log(`base URL (owned): ${opts.baseUrl}`);

  const browser: Browser = await chromium.launch({ headless: !opts.headed });
  const records: ReplayRecord[] = [];
  // One context per distinct DPR — deviceScaleFactor is a context-creation
  // option, not a per-page setViewportSize. Reuse a context across links that
  // share a DPR (each gets its own page sized to its own viewport).
  const contextsByDpr = new Map<number, BrowserContext>();

  try {
    for (const { link, camera, viewport } of decoded) {
      let context = contextsByDpr.get(viewport.dpr);
      if (context === undefined) {
        context = await browser.newContext({ deviceScaleFactor: viewport.dpr });
        contextsByDpr.set(viewport.dpr, context);
      }
      const pageViewport = { width: viewport.w, height: viewport.h, dpr: viewport.dpr };
      console.log(
        `  • ${link.label}: ${pageViewport.width}×${pageViewport.height} @${pageViewport.dpr} ` +
          `→ z${camera.zoom} ${camera.lat},${camera.lng}`,
      );
      const record = await replayOne(
        context,
        link,
        camera,
        pageViewport,
        opts.baseUrl,
        opts.outDir,
      );
      records.push(record);
    }
  } finally {
    for (const context of contextsByDpr.values()) await context.close();
    await browser.close();
  }

  // JSON-first: the AC-named shape `[{label,url,requestUrl,responseBody,screenshotPath}]`
  // (plus additive `viewport`/`summary` keys for the diff).
  const reportPath = path.join(opts.outDir, 'replay-report.json');
  await writeFile(reportPath, JSON.stringify(records, null, 2) + '\n', 'utf8');

  const diffPath = path.join(opts.outDir, 'replay-diff.md');
  await writeFile(diffPath, renderDiffMarkdown(records), 'utf8');

  console.log(`\n✔ wrote ${records.length} screenshot(s)`);
  console.log(`✔ report: ${reportPath}`);
  console.log(`✔ diff:   ${diffPath}`);
}

main().catch((err: unknown) => {
  console.error('\nreplay-viewbox failed:');
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
