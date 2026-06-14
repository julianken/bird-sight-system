import type Database from 'better-sqlite3';
import type { QualityReport, CriteriaScores } from '@bird-watch/photo-quality';
import { defaultRubricConfig } from '@bird-watch/photo-quality';
import { selectSwaps } from './swaps.js';
import {
  upsertCurrentPhoto, upsertScore, clearSwapSelection, setSourceAttemptOutcome,
} from './store.js';

/**
 * apply-swaps resolves source_attempt outcomes against this source (#974). The
 * apply path reads the legacy photo_decision approve rows, which don't carry the
 * search source, so 'inat' is assumed — the only image source wired today. When
 * a second source is added, thread it through ApplyDeps and selectPendingSwaps
 * (the photo_decision row would need a `source` column) and pass it here.
 */
const APPLY_SOURCE = 'inat';

/**
 * swap-review v2 §3 — the operator-override-aware apply source. Derives the
 * appliable swaps from selectSwaps, whose `proposed` ALREADY reflects the
 * swap_selection override (operator click-to-pick wins over the auto Δ≥20 gate;
 * an explicit "no swap" yields proposed=null). Returns one PendingSwap per
 * species with a non-null proposal, so apply-swaps and the pending-swaps page
 * read the SAME selection and can never diverge.
 *
 * Follow-up (#974): the legacy `runApplySwaps` path below still reads the
 * human approve/deny `photo_decision` rows, which is a SEPARATE selection
 * mechanism from the auto-gate + override flow. This function is the bridge —
 * the CLI/runner can apply from EITHER source. Unifying the two (folding the
 * approve decision into swap_selection, or vice versa) is a deliberate
 * follow-up, not done here, to keep the confirm-gated approve workflow's
 * behaviour unchanged for this PR.
 */
export function selectAppliableSwaps(db: Database.Database): PendingSwap[] {
  return selectSwaps(db)
    .filter(s => s.proposed !== null)
    .map(s => {
      const p = s.proposed!;
      return {
        speciesCode: s.speciesCode,
        comName: s.comName,
        oldUrl: s.current.photoUrl || '(none)',
        newUrl: p.photoUrl,
        attribution: p.attribution,
        license: p.license,
        chosenCandidateId: p.candidateId,
        inatId: p.inatId,
      };
    });
}

/**
 * Staged apply (spec §5.6). Reads `photo_decision` rows where
 * action='approve' AND applied=0, joins the chosen candidate + current photo,
 * prints a confirm summary, and on confirmation PUTs each swap to the prod
 * admin endpoint `PUT /admin/species-photos/:speciesCode`. A 2xx marks the row
 * applied=1; any non-2xx / network error leaves it applied=0 and reports it for
 * retry. Per-species isolation: one failure does not abort the batch.
 *
 * Everything external (the SQLite handle, fetch, confirmation prompt, clock,
 * logger) is injected so the path is unit-testable without real network/IO —
 * the same DI idiom as services/ingestor/src/cli.ts (runCli(kind, deps)).
 */
export interface ApplyDeps {
  db: Database.Database;
  adminBase: string;                 // ADMIN_API_URL, e.g. https://admin.bird-maps.com
  adminToken: string;                // ADMIN_API_TOKEN bearer
  fetch: typeof globalThis.fetch;
  log: (line: string) => void;       // summary output; production = console.log
  confirm: () => Promise<boolean>;   // operator y/N gate; production = stdin prompt
  now: () => string;                 // ISO timestamp; injectable for deterministic tests
}

export interface PendingSwap {
  speciesCode: string;
  comName: string;
  oldUrl: string;                    // photo_current.url (display only)
  newUrl: string;                    // chosen candidate's photo_url → admin `sourceUrl`
  attribution: string;
  license: string;
  // #974 local-promotion fields: the candidate being applied. On a successful
  // prod push these promote the candidate to the species' CURRENT photo + score
  // so it leaves the keep=0 needs-swap set. Optional so the override-derived
  // selectAppliableSwaps source (which has no decision row) still type-checks.
  chosenCandidateId?: number;        // photo_candidate.id of the applied candidate
  inatId?: number;                   // photo_candidate.inat_id (joins to its role='candidate' score)
}

export interface ApplyFailure {
  speciesCode: string;
  reason: string;
}

export interface ApplyResult {
  applied: string[];                 // species codes successfully pushed + marked
  failed: ApplyFailure[];            // species codes that errored (left un-applied)
  alreadyAppliedTotal: number;       // count of ALL action='approve' rows already applied=1 (cumulative, informational)
  aborted: boolean;                  // true when the operator declined the confirm
}

/**
 * Selects approvable swaps. INNER JOIN on photo_candidate guarantees the chosen
 * candidate still exists; LEFT JOIN on photo_current so a brand-new species
 * (no prior live photo) still applies (oldUrl falls back to '(none)'). The
 * `cand.excluded = 0` guard defends against a future flow that re-excludes a
 * candidate after it was approved — an excluded candidate must never be pushed.
 */
function selectPendingSwaps(db: Database.Database): PendingSwap[] {
  const rows = db
    .prepare(
      `SELECT d.species_code   AS speciesCode,
              COALESCE(cur.com_name, d.species_code) AS comName,
              COALESCE(cur.url, '(none)')            AS oldUrl,
              cand.photo_url    AS newUrl,
              cand.attribution  AS attribution,
              cand.license      AS license,
              cand.id           AS chosenCandidateId,
              cand.inat_id      AS inatId
         FROM photo_decision d
         JOIN photo_candidate cand ON cand.id = d.chosen_candidate_id
         LEFT JOIN photo_current cur ON cur.species_code = d.species_code
        WHERE d.action = 'approve' AND d.applied = 0 AND cand.excluded = 0
        ORDER BY d.species_code`,
    )
    .all() as PendingSwap[];
  return rows;
}

function countAlreadyApplied(db: Database.Database): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM photo_decision WHERE action = 'approve' AND applied = 1`)
    .get() as { n: number };
  return row.n;
}

/** The admin PUT response (best-effort). `url` is the new content-hashed prod URL. */
interface AdminPutResponse { url?: string; key?: string }

async function pushOne(deps: ApplyDeps, swap: PendingSwap): Promise<AdminPutResponse> {
  const url = `${deps.adminBase.replace(/\/$/, '')}/admin/species-photos/${swap.speciesCode}`;
  const res = await deps.fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${deps.adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sourceUrl: swap.newUrl,
      attribution: swap.attribution,
      license: swap.license,
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // body unreadable — status alone is enough context for retry triage
    }
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  // The admin endpoint returns the new content-hashed prod URL — used as the
  // promoted photo_current.url when present. A body we can't parse is non-fatal:
  // the push succeeded, so fall back to the candidate's source url for promotion.
  try {
    return (await res.json()) as AdminPutResponse;
  } catch {
    return {};
  }
}

/**
 * Promote the just-applied candidate to the species' CURRENT photo + score
 * (#974), in ONE transaction with marking the decision applied. After this the
 * species' current keep flips to the candidate's keep (a good swap → keep=1), so
 * it drops out of the keep=0 / needs-swap set and the overall list updates.
 *
 *  • photo_current.url/attribution/license → the prod URL the admin endpoint
 *    returned (content-hashed), or the candidate's source url as a fallback.
 *  • photo_score role='current' ← the candidate's STORED report (its keep,
 *    quality_score, field_marks, criteria, flags, rationale, content_hash) at the
 *    current rubric_version.
 *  • source_attempt → 'applied' (best_score = the promoted quality_score).
 *  • swap_selection cleared (the swap is done).
 *
 * Skipped (with a logged note, never thrown) when the candidate has no stored
 * role='candidate' score — promotion needs the report, and a missing one means
 * the candidate was approved out-of-band; the prod push already succeeded, so we
 * still mark the decision applied and leave the local current photo untouched.
 */
function promoteApplied(
  deps: ApplyDeps, swap: PendingSwap, prodUrl: string | undefined,
): void {
  const db = deps.db;
  const inatId = swap.inatId;
  if (inatId === undefined) {
    deps.log(`  note ${swap.speciesCode}: no inat id on the swap — skipped local promotion`);
    return;
  }
  // The candidate's stored report (role='candidate') by its inat id. content_hash
  // isn't known here, so read by (species, role, inat) directly.
  const candRow = db.prepare(
    `SELECT content_hash, overall, verdict, criteria_json, flags_json, keep,
            quality_score, field_marks, rationale, rubric_version
       FROM photo_score
      WHERE species_code = ? AND role = 'candidate' AND candidate_inat_id = ?`,
  ).get(swap.speciesCode, inatId) as CandidateScoreRow | undefined;
  if (!candRow) {
    deps.log(`  note ${swap.speciesCode}: no stored candidate score for inat ${inatId} — pushed to prod, skipped local promotion`);
    return;
  }

  const cur = db.prepare(
    `SELECT com_name, sci_name, family FROM photo_current WHERE species_code = ?`,
  ).get(swap.speciesCode) as { com_name: string | null; sci_name: string | null; family: string | null } | undefined;

  const newHash = candRow.content_hash ?? '';
  const newUrl = prodUrl ?? swap.newUrl;
  const report: QualityReport = {
    overall: candRow.overall,
    verdict: candRow.verdict as QualityReport['verdict'],
    deterministic: {
      width: 0, height: 0, megapixels: 0, sharpness: 0, exposure: 0, aspectRatio: 0,
      passedGate: true, failReasons: [],
    },
    criteria: JSON.parse(candRow.criteria_json) as CriteriaScores,
    flags: JSON.parse(candRow.flags_json) as string[],
    fieldMarks: candRow.field_marks ? (JSON.parse(candRow.field_marks) as string[]) : [],
    keep: candRow.keep === 1,
    qualityScore: candRow.quality_score ?? candRow.overall,
    rationale: candRow.rationale,
    // promote to the CURRENT rubric version (apply forward only — no re-scoring).
    rubricVersion: defaultRubricConfig.version,
  };

  // photo_current → the candidate's photo. upsertCurrentPhoto resets reviewed=0
  // is NOT desired here, but the displayed list keys on photo_score.keep, so the
  // upsert below + the role='current' score upsert together flip keep to the
  // candidate's. (upsertCurrentPhoto leaves reviewed at its column default; a
  // re-score pass would reset it, which we don't run — apply forward only.)
  upsertCurrentPhoto(db, {
    speciesCode: swap.speciesCode,
    comName: cur?.com_name ?? swap.comName,
    sciName: cur?.sci_name ?? '',
    family: cur?.family ?? '',
    url: newUrl,
    attribution: swap.attribution,
    license: swap.license,
    contentHash: newHash,
  });
  // Replace the species' role='current' score outright. upsertScore keys on
  // (species_code, role, content_hash), so a NEW content_hash would INSERT a
  // second current-role row and leave the stale keep=0 row behind — the species
  // would still appear in needs-swap. Delete the old current score(s) first so
  // exactly one current-role row (the promoted keep=1 candidate) remains.
  db.prepare(`DELETE FROM photo_score WHERE species_code = ? AND role = 'current'`)
    .run(swap.speciesCode);
  upsertScore(db, {
    speciesCode: swap.speciesCode, role: 'current', candidateInatId: null,
    contentHash: newHash, report,
  });
  setSourceAttemptOutcome(db, swap.speciesCode, APPLY_SOURCE, 'applied', Math.round(report.qualityScore));
  clearSwapSelection(db, swap.speciesCode);
}

interface CandidateScoreRow {
  content_hash: string | null;
  overall: number;
  verdict: string;
  criteria_json: string;
  flags_json: string;
  keep: number | null;
  quality_score: number | null;
  field_marks: string | null;
  rationale: string;
  rubric_version: string;
}

export async function runApplySwaps(deps: ApplyDeps): Promise<ApplyResult> {
  const swaps = selectPendingSwaps(deps.db);
  const alreadyAppliedTotal = countAlreadyApplied(deps.db);

  if (swaps.length === 0) {
    deps.log(
      alreadyAppliedTotal > 0
        ? `Nothing to apply — ${alreadyAppliedTotal} approved swap(s) already applied.`
        : 'Nothing to apply — no approved swaps staged.',
    );
    return { applied: [], failed: [], alreadyAppliedTotal, aborted: false };
  }

  // Confirm summary: N species, old→new, license. Mutates prod only on "yes".
  deps.log(`About to apply ${swaps.length} approved photo swap(s):`);
  for (const s of swaps) {
    deps.log(`  ${s.speciesCode} (${s.comName})`);
    deps.log(`    from: ${s.oldUrl}`);
    deps.log(`    to:   ${s.newUrl}  [${s.license}]`);
  }
  const ok = await deps.confirm();
  if (!ok) {
    deps.log('Aborted — no changes pushed.');
    return { applied: [], failed: [], alreadyAppliedTotal, aborted: true };
  }

  const markApplied = deps.db.prepare(
    `UPDATE photo_decision SET applied = 1, applied_at = ? WHERE species_code = ?`,
  );

  const applied: string[] = [];
  const failed: ApplyFailure[] = [];

  // Per-species isolation: one bad apply must not abort the batch. Failures
  // stay applied=0 for retry — R2-before-DB ordering inside the admin endpoint
  // means a failed apply never leaves a dangling live URL (spec §8).
  for (const swap of swaps) {
    try {
      // Prod push FIRST. Only on a 2xx do we mark applied AND promote the
      // candidate to the species' current — both in one transaction so a
      // promotion that throws never leaves a half-applied local state (#974). A
      // push failure throws here, before any local mutation.
      const prod = await pushOne(deps, swap);
      const commit = deps.db.transaction(() => {
        markApplied.run(deps.now(), swap.speciesCode);
        promoteApplied(deps, swap, prod.url);
      });
      commit();
      applied.push(swap.speciesCode);
      deps.log(`  OK  ${swap.speciesCode}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ speciesCode: swap.speciesCode, reason });
      deps.log(`  ERR ${swap.speciesCode}: ${reason}`);
    }
  }

  deps.log(`Applied ${applied.length}, failed ${failed.length}.`);
  if (failed.length > 0) {
    deps.log('Failures left un-applied for retry:');
    for (const f of failed) deps.log(`  ${f.speciesCode}: ${f.reason}`);
  }
  return { applied, failed, alreadyAppliedTotal, aborted: false };
}

export type AdminEnv =
  | { ok: true; adminBase: string; adminToken: string }
  | { ok: false; error: string };

/**
 * Resolves the admin endpoint env, mirroring scripts/curation/silhouette.mjs's contract:
 * both ADMIN_API_URL and ADMIN_API_TOKEN must be present. Returned as a result
 * object (not a throw) so the CLI maps a missing-env to exit code 2 — the same
 * code silhouette.mjs returns for missing env.
 */
export function resolveAdminEnv(env: NodeJS.ProcessEnv): AdminEnv {
  const adminBase = env.ADMIN_API_URL;
  const adminToken = env.ADMIN_API_TOKEN;
  if (!adminBase) return { ok: false, error: 'ADMIN_API_URL must be set in env' };
  if (!adminToken) return { ok: false, error: 'ADMIN_API_TOKEN must be set in env' };
  return { ok: true, adminBase, adminToken };
}
