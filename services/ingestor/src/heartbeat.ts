/**
 * Best-effort heartbeat ping to Healthchecks.io (or equivalent).
 *
 * Pings are fire-and-forget: a failure to ping does not change the ingest
 * job's exit code. The semantics are inverse-of-presence: if Healthchecks.io
 * sees a ping, the job ran to success; if it doesn't, Healthchecks.io fires
 * the alert (we never need to fire one ourselves).
 *
 * Why `fetcher` is injectable: lets tests pass a mock without touching
 * global fetch state, which is otherwise leaked across tests in the same
 * vitest worker.
 *
 * See docs/plans/2026-05-17-monitoring-and-alerts.md §S7 for the design
 * rationale (out-of-band heartbeat vs. Cloud Monitoring custom-metric
 * absent-for).
 */
export async function pingHeartbeat(
  url: string | undefined,
  kind: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!url) return;
  try {
    const res = await fetcher(url, { method: 'POST' });
    if (!res.ok) {
      console.warn(`[heartbeat] ${kind}: non-2xx response ${res.status}`);
    }
  } catch (err) {
    console.warn(`[heartbeat] ${kind}: network error`, err);
  }
}
