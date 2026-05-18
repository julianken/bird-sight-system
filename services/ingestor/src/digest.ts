/**
 * Daily bird-watch health digest.
 *
 * Composes a single email summarizing the operational signals an operator
 * would otherwise have to open a Cloud Console tab to consume:
 *
 *   1. Per-kind ingest_runs counts over the last 24h (success vs failure).
 *      Coverage gap: `photos` and `descriptions` kinds do NOT write to the
 *      ingest_runs table today (analysis report §F9). The digest enumerates
 *      the 5 covered kinds explicitly so the operator can see that 2 of
 *      the 7 ingest kinds are not being measured at all — i.e., the
 *      negative space is legible. Retrofit is tracked at PR-2 merge time
 *      per Contract C4 in
 *      docs/analyses/2026-05-18-monitoring-dashboard-issue-638/phase-4/
 *      analysis-report.md.
 *   2. Read-api p95 latency over last 24h (from Cloud Monitoring API).
 *   3. Cloud SQL CPU max over last 24h.
 *   4. Data freshness (meta_freshness_seconds p95 over last 24h) — see also
 *      §S2 in monitoring.tf.
 *   5. Top 3 errors from Cloud Logging.
 *
 * Why heartbeat gates on delivery, not function success: per analysis report
 * §F7, SendGrid (or any SMTP) can reject a message for SPF/DKIM/DMARC drift
 * even when the function returns 200 OK. Pinging Healthchecks.io on function
 * exit would mark the digest "delivered" in HC's mental model when it never
 * landed in the inbox — destroying the falsifiability that the heartbeat was
 * supposed to provide. The runDigest function therefore returns a SendResult
 * to its caller (cli.ts), and ONLY the caller decides whether to ping the
 * heartbeat — based on `status === 'delivered'`.
 */

import type { Pool } from '@bird-watch/db-client';

/**
 * The 5 ingest kinds we display in the digest body. `photos` and
 * `descriptions` are deliberately excluded — they do not write to
 * ingest_runs today (analysis report §F9). When the retrofit ticket from
 * Contract C4 lands, add them here.
 */
export const DIGEST_INGEST_KINDS = [
  'recent',
  'backfill',
  'hotspots',
  'taxonomy',
  'prune',
] as const;

export interface IngestRunCount {
  kind: string;
  status: string;
  count: number;
}

export interface TopError {
  message: string;
  count: number;
}

export interface MonitoringSignals {
  readApiP95Ms: number | null;
  cloudSqlCpuPct: number | null;
  freshnessMaxSeconds: number | null;
  topErrors: TopError[];
}

export interface DigestData extends MonitoringSignals {
  ingestRuns24h: IngestRunCount[];
}

export interface SendResult {
  /**
   * - `delivered`: the email provider accepted the message AND we have
   *   confidence it reached the recipient (e.g., SendGrid 2xx + no bounce
   *   webhook within a short window, OR a direct SMTP 250). Only this
   *   status triggers the Healthchecks.io heartbeat.
   * - `queued`: provider accepted the message but final delivery is still
   *   pending an out-of-band confirmation. Heartbeat is NOT pinged from
   *   this state — a follow-up webhook caller is responsible for transitioning
   *   to `delivered` (or `failed`).
   * - `failed`: provider rejected, sender-auth failed, network error, etc.
   *   Heartbeat is NOT pinged.
   */
  status: 'delivered' | 'queued' | 'failed';
  providerMessageId?: string;
  error?: string;
}

export interface RunDigestOptions {
  pool: Pool;
  emailRecipient: string;
  sendEmail: (subject: string, body: string) => Promise<SendResult>;
  /**
   * Injectable so tests can supply canned values without standing up a
   * Cloud Monitoring + Cloud Logging client. In production the cli wrapper
   * wires the real Monitoring/Logging clients.
   */
  fetchMonitoringSignals: () => Promise<MonitoringSignals>;
  /**
   * Optional clock injection for deterministic test output (matches the
   * "now" stamp in the rendered digest header).
   */
  now?: () => Date;
}

/**
 * Query ingest_runs for the last 24h, grouped by kind+status. Only the kinds
 * in DIGEST_INGEST_KINDS are returned — photos/descriptions are filtered out
 * at the SQL level so the digest renders only the 5 measured kinds. The
 * absence of photos/descriptions in the rendered output is intentional and
 * documented (see analysis report §F9).
 */
export async function fetchIngestRuns24h(pool: Pool): Promise<IngestRunCount[]> {
  const { rows } = await pool.query<{
    kind: string;
    status: string;
    count: string;
  }>(
    `SELECT kind, status, COUNT(*)::text AS count
     FROM ingest_runs
     WHERE started_at >= now() - INTERVAL '24 hours'
       AND kind = ANY($1::text[])
     GROUP BY kind, status
     ORDER BY kind, status`,
    [DIGEST_INGEST_KINDS as unknown as string[]]
  );
  return rows.map((r) => ({
    kind: r.kind,
    status: r.status,
    count: Number.parseInt(r.count, 10),
  }));
}

/**
 * Render the digest body as plain text. Plain text (not HTML) keeps the
 * surface small and rules out an entire class of email-rendering bugs;
 * the operator audience is one person and Gmail's monospace fallback is
 * legible enough.
 *
 * The 5-kinds enumeration is explicit — every kind in DIGEST_INGEST_KINDS
 * appears, even when its count is zero. This makes the photos/descriptions
 * absence legible (they are simply NOT in the list at all).
 */
export function renderDigestBody(data: DigestData, nowIso: string): string {
  const lines: string[] = [];
  lines.push(`bird-watch daily health digest — ${nowIso}`);
  lines.push('');
  lines.push('Coverage note: this digest reports on 5 of the 7 ingest kinds.');
  lines.push('The `photos` and `descriptions` kinds do NOT yet write to the');
  lines.push('ingest_runs table (analysis report §F9). Retrofit is tracked as a');
  lines.push('follow-up at PR-2 merge time per Contract C4.');
  lines.push('');
  lines.push('=== Ingest runs (last 24h) ===');
  for (const kind of DIGEST_INGEST_KINDS) {
    const kindRows = data.ingestRuns24h.filter((r) => r.kind === kind);
    if (kindRows.length === 0) {
      lines.push(`  ${kind.padEnd(12)} no runs in last 24h`);
      continue;
    }
    const parts = kindRows
      .sort((a, b) => a.status.localeCompare(b.status))
      .map((r) => `${r.count} ${r.status}`)
      .join(' / ');
    lines.push(`  ${kind.padEnd(12)} ${parts}`);
  }
  lines.push('');
  lines.push('=== Read-API p95 latency (last 24h) ===');
  lines.push(
    data.readApiP95Ms === null
      ? '  unavailable'
      : `  ${data.readApiP95Ms.toFixed(0)} ms`
  );
  lines.push('');
  lines.push('=== Cloud SQL CPU max (last 24h) ===');
  lines.push(
    data.cloudSqlCpuPct === null
      ? '  unavailable'
      : `  ${(data.cloudSqlCpuPct * 100).toFixed(1)} %`
  );
  lines.push('');
  lines.push('=== Data freshness — meta_freshness_seconds p95 (last 24h) ===');
  lines.push(
    data.freshnessMaxSeconds === null
      ? '  unavailable'
      : `  ${data.freshnessMaxSeconds.toFixed(0)} s` +
          ` (≈ ${(data.freshnessMaxSeconds / 60).toFixed(1)} min)`
  );
  lines.push('');
  lines.push('=== Top 3 errors (last 24h) ===');
  if (data.topErrors.length === 0) {
    lines.push('  none');
  } else {
    for (const e of data.topErrors.slice(0, 3)) {
      lines.push(`  [${e.count}] ${e.message}`);
    }
  }
  lines.push('');
  lines.push('Runbook: docs/runbooks/monitoring.md#digest');
  return lines.join('\n');
}

/**
 * Compose + send the daily digest. Returns the SendResult so the caller
 * (cli.ts) can gate the Healthchecks.io heartbeat on delivery confirmation,
 * not function success.
 *
 * Errors during composition (DB query failure, fetchMonitoringSignals
 * throwing) propagate to the caller — those are not "delivery failed",
 * they're function failed, and the caller treats them as such (no heartbeat
 * ping, exit code 1).
 */
export async function runDigest(opts: RunDigestOptions): Promise<SendResult> {
  const now = opts.now ? opts.now() : new Date();
  const nowIso = now.toISOString();
  const [ingestRuns24h, monitoring] = await Promise.all([
    fetchIngestRuns24h(opts.pool),
    opts.fetchMonitoringSignals(),
  ]);
  const data: DigestData = { ingestRuns24h, ...monitoring };
  const body = renderDigestBody(data, nowIso);
  const subject = `bird-watch daily health digest — ${nowIso.slice(0, 10)}`;
  return opts.sendEmail(subject, body);
}
