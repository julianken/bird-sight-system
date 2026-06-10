import type Database from 'better-sqlite3';

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
              cand.license      AS license
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

async function pushOne(deps: ApplyDeps, swap: PendingSwap): Promise<void> {
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
      await pushOne(deps, swap);
      markApplied.run(deps.now(), swap.speciesCode);
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
 * Resolves the admin endpoint env, mirroring scripts/silhouette.mjs's contract:
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
