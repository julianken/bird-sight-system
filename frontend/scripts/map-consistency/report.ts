// frontend/scripts/map-consistency/report.ts
// C5 (#1271): turn findings.json into the preserved findings brief — a durable,
// self-contained evidence bundle per FAIL so the run stays analyzable after prod
// data shifts. Pure node fs; no Playwright, no network. Reads the run's `raw/` +
// `shots/` (persisted per-view by audit.ts) and assembles `brief.md` plus one
// `findings/<F-id>/` bundle per fail.
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Sample, Verdict } from './types.js';

export interface Findings {
  runMeta: Record<string, unknown>;
  summary: Record<string, unknown>;
  verdicts: Verdict[];
}

/** Per-view evidence stem — MUST match the stem audit.ts persists under raw/ + shots/. */
const stem = (sampleId: string, vp: string, zoom: number): string => `${sampleId}-${vp}-z${zoom}`;

/** The #map= viewbox links a verdict carries (epic #1238). Cross-view relations
 *  (MR-8/MR-9 pill-collapse) carry BOTH desktopUrl + mobileUrl — a pill-collapse
 *  finding is only reproducible with the desktop AND the mobile camera, so both are
 *  surfaced. Drill-down (MR-0) carries parentUrl + childUrl. Per-view relations
 *  carry a single `url`. */
function reproUrls(v: Verdict): string[] {
  const e = v.evidence ?? {};
  return [e.parentUrl, e.childUrl, e.desktopUrl, e.mobileUrl, e.url].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
}

/** Assemble brief.md + one evidence bundle per FAIL verdict. */
export async function writeBrief(f: Findings, outDir: string, samples: Sample[]): Promise<void> {
  const fails = f.verdicts.filter((v) => v.status === 'fail');
  const lines: string[] = [];
  lines.push(`# Map consistency audit — ${f.runMeta.scope}, ${f.runMeta.samples} samples, seed ${f.runMeta.seed}`);
  const fresh = (f.runMeta.freshestRange as string[] | undefined) ?? [];
  lines.push(`Run: \`${f.runMeta.command}\` · prod freshest range: ${fresh.join(' … ') || 'n/a'}`);
  lines.push(`\n## Summary\n`);
  lines.push(`${fails.length} findings / ${f.verdicts.length} checks. By relation: ${JSON.stringify(f.summary.byRelation ?? {})}`);
  lines.push(`\n| # | Relation | Severity | Deterministic | Symptom |`);
  lines.push(`|---|---|---|---|---|`);

  for (let i = 0; i < fails.length; i++) {
    const v = fails[i]!;
    const id = `F${i + 1}`;
    const det = v.evidence?.deterministic;
    lines.push(`| ${id} | ${v.relation} | ${v.severity ?? '-'} | ${det === undefined ? '?' : det} | ${(v.symptom ?? '').replace(/\|/g, '\\|')} |`);
    await writeFindingBundle(id, v, outDir, samples);
  }

  lines.push(`\n## Findings\n`);
  if (fails.length === 0) {
    lines.push(`_No fails in this run._\n`);
  }
  for (let i = 0; i < fails.length; i++) {
    const v = fails[i]!;
    const id = `F${i + 1}`;
    lines.push(`### ${id} — ${v.relation} — ${v.severity ?? ''}`);
    lines.push(`${v.symptom ?? ''}`);
    lines.push(`- Numbers: \`${JSON.stringify(v.numbers ?? {})}\`${v.carveOuts ? ` · carve-outs: ${v.carveOuts.join(', ')}` : ''}`);
    // The #map= viewbox link (epic #1238) IS the canonical one-click repro — it
    // bakes in viewport + scope + filters. Surface it in the brief itself so any
    // ticket written from this finding can carry it verbatim. A pill-collapse
    // (MR-8/MR-9) emits BOTH the desktop and mobile viewbox link.
    for (const u of reproUrls(v)) lines.push(`- 🔗 viewbox repro: ${u}`);
    lines.push(`- Evidence bundle: \`findings/${id}/\` · Sample: ${v.sampleId}\n`);
  }
  await writeFile(path.join(outDir, 'brief.md'), lines.join('\n'));
}

export async function writeFindingBundle(id: string, v: Verdict, outDir: string, samples: Sample[]): Promise<void> {
  const dir = path.join(outDir, 'findings', id);
  await mkdir(dir, { recursive: true });
  const sample = samples.find((s) => s.id === v.sampleId);
  const urls = reproUrls(v);
  await writeFile(
    path.join(dir, 'repro.md'),
    [
      `# ${id} — ${v.relation}`,
      v.symptom ?? '',
      '',
      '## Reproduce — open the #map= viewbox link(s) below (epic #1238; viewport + scope + filters are baked in):',
      ...urls.map((u) => `- ${u}`),
      '',
      '> When filing a ticket from this finding, INCLUDE the viewbox link above — it is the canonical one-click reproduction.',
      '',
      `Numbers: ${JSON.stringify(v.numbers ?? {})}`,
    ].join('\n'),
  );
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(v, null, 2));
  // Copy the relevant screenshots + raw payloads from the run dirs (best-effort).
  // For a cross-view fail (MR-8/MR-9), `urls` holds both the desktop and mobile
  // viewbox links, so BOTH viewports' screenshots + payloads are copied. For a
  // drill-down (MR-0) the parent view lands as observations-parent.json and the
  // failing (deeper) view as observations-child.json.
  if (sample) {
    const minZoom = Math.min(...sample.views.map((x) => x.requestedZoom));
    for (const view of sample.views) {
      if (!urls.includes(view.url)) continue;
      const s = stem(sample.id, view.viewport, view.requestedZoom);
      await copyFile(path.join(outDir, 'shots', `${s}.png`), path.join(dir, `${view.viewport}.png`)).catch(() => {});
      const payloadName = view.requestedZoom === minZoom ? 'observations-parent.json' : 'observations-child.json';
      await copyFile(path.join(outDir, 'raw', `${s}.json`), path.join(dir, payloadName)).catch(() => {});
      await writeFile(path.join(dir, 'console.log'), [...view.consoleErrors, ...view.consoleWarnings].join('\n')).catch(() => {});
    }
  }
}
