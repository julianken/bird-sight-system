/**
 * Production providers for the digest function: SendGrid email sender and
 * Cloud Monitoring + Cloud Logging signals fetcher. These thin wrappers are
 * imported only from cli.ts's IIFE — runDigest itself stays
 * provider-agnostic (it accepts injectable `sendEmail` and
 * `fetchMonitoringSignals` deps), which keeps the unit tests in
 * digest.test.ts honest.
 *
 * Why fetch instead of `@sendgrid/mail`: the SendGrid /v3/mail/send REST
 * endpoint is a 50-line HTTP call. Pulling in the SDK would add a new
 * top-level dependency to the ingestor service for one method. The fetch
 * approach also keeps `tsx`-driven local invocation working without
 * additional install steps.
 *
 * Sender-authentication discipline (DNS records on bird-maps.com, populated
 * out-of-band by the operator post-merge):
 *   - SPF (TXT @ root):       v=spf1 include:sendgrid.net ~all
 *   - DKIM (CNAME):           s1._domainkey -> s1.domainkey.uXXXX.wlYYY.sendgrid.net
 *                             s2._domainkey -> s2.domainkey.uXXXX.wlYYY.sendgrid.net
 *   - DMARC (TXT _dmarc):     v=DMARC1; p=none; rua=mailto:julian.kennon.d@gmail.com
 *
 * Without those records SendGrid will accept the message and return 2xx —
 * but Gmail will reject the inbound message at the SMTP layer, the heartbeat
 * will incorrectly fire (because we ping on SendGrid 2xx), and the
 * negative-space surveillance breaks silently. The runbook at
 * docs/runbooks/monitoring.md#digest covers the verification dig command.
 */

import type { MonitoringSignals, SendResult } from './digest.js';

export interface SendGridSenderConfig {
  apiKey: string;
  recipient: string;
  /** e.g. "digest@bird-maps.com" — MUST match a verified sender domain. */
  from: string;
  /** Injectable for tests; defaults to global fetch in Node 20+. */
  fetcher?: typeof fetch;
}

/**
 * Build a SendResult-returning sender bound to a SendGrid API key + From
 * address. Returns `status: 'delivered'` only on SendGrid 2xx; a 4xx
 * (typically sender-auth misconfig, malformed payload) returns `failed`
 * and the heartbeat does not fire.
 *
 * Note: SendGrid 2xx confirms acceptance into SendGrid's pipeline, NOT
 * confirmation of inbox delivery — a follow-up "Event Webhook" subscriber
 * is the only authoritative inbox-delivery signal. For v1 we treat 2xx
 * as `delivered` and document the residual SPF/DKIM/DMARC failure mode
 * in the runbook (the operator should observe the alert chain end-to-end
 * once post-merge and tighten if SendGrid-2xx-but-Gmail-rejects becomes a
 * real failure mode).
 */
export function makeSendGridSender(cfg: SendGridSenderConfig) {
  const fetcher = cfg.fetcher ?? fetch;
  return async function sendEmail(subject: string, body: string): Promise<SendResult> {
    try {
      const res = await fetcher('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: cfg.recipient }] }],
          from: { email: cfg.from },
          subject,
          content: [{ type: 'text/plain', value: body }],
        }),
      });
      if (res.status >= 200 && res.status < 300) {
        const providerMessageId = res.headers.get('X-Message-Id') ?? undefined;
        return providerMessageId
          ? { status: 'delivered', providerMessageId }
          : { status: 'delivered' };
      }
      const error = `SendGrid ${res.status}: ${await res.text().catch(() => '')}`;
      return { status: 'failed', error };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'failed', error: `SendGrid network error: ${message}` };
    }
  };
}

/**
 * Build a MonitoringSignals fetcher that returns null for every signal.
 * This is the v1 floor — populating the Cloud Monitoring + Cloud Logging
 * client wiring is deferred to a follow-up because the dashboard PR (#642)
 * also touches these clients and consolidating reduces churn. The renderer
 * already handles `null` gracefully (renders "unavailable"), so the
 * delivered digest still carries the ingest_runs signal which is the
 * highest-value piece of the surveillance surface.
 *
 * When the Monitoring + Logging clients are wired post-#642, replace this
 * with an implementation that queries:
 *   - `run.googleapis.com/request_latencies` for readApiP95Ms (filter by
 *     service_name="bird-read-api", last 24h, ALIGN_PERCENTILE_95)
 *   - `cloudsql.googleapis.com/database/cpu/utilization` for cloudSqlCpuPct
 *     (filter by database_id="bird-maps-prod:birdwatch-pg16", last 24h max)
 *   - `logging.googleapis.com/user/bird-meta-freshness-seconds` for
 *     freshnessMaxSeconds (or curl the read-api /api/health endpoint —
 *     cheaper)
 *   - Cloud Logging severity>=ERROR over last 24h grouped by
 *     jsonPayload.message (top 3 by count) for topErrors
 */
export function makeNullMonitoringSignalsFetcher(): () => Promise<MonitoringSignals> {
  return async () => ({
    readApiP95Ms: null,
    cloudSqlCpuPct: null,
    freshnessMaxSeconds: null,
    topErrors: [],
  });
}
