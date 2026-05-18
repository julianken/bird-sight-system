// Local read-only dashboard server for the going-national rollout.
// Polls GitHub (via `gh`), production HTTP endpoints, and GCP (via `gcloud`)
// every POLL_INTERVAL_MS, caches the result, and serves it at /api/status.
//
// Run: npm install && npm start ; open http://localhost:7777
//
// Uses the user's existing gh + gcloud auth. No secrets read or written.

import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 7777;
const POLL_INTERVAL_MS = 30_000;
const REPO = "julianken/bird-sight-system";
const GCP_PROJECT = "bird-maps-prod";

const UMBRELLA_ISSUES = [588, 589, 593, 596, 533, 604, 608, 611];
const HEALTHCHECK_SECRETS = [
  "bird-watch-healthchecks-recent",
  "bird-watch-healthchecks-notable",
  "bird-watch-healthchecks-hotspots",
  "bird-watch-healthchecks-taxonomy",
  "bird-watch-healthchecks-prune",
  "bird-watch-healthchecks-silhouettes",
  "bird-watch-healthchecks-shape2-probe",
];

// ----- helpers -----

async function sh(cmd, args, opts = {}) {
  try {
    const { stdout } = await execFileP(cmd, args, { timeout: 20_000, ...opts });
    return { ok: true, stdout: stdout.trim() };
  } catch (e) {
    return { ok: false, error: e.message, stdout: (e.stdout || "").trim(), stderr: (e.stderr || "").trim() };
  }
}

async function curlHeaders(url) {
  const r = await sh("curl", ["-sS", "-I", "--max-time", "10", url]);
  if (!r.ok) return { ok: false, error: r.error };
  const headers = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  const statusLine = r.stdout.split(/\r?\n/)[0] || "";
  const sm = statusLine.match(/\s(\d{3})\s/);
  return { ok: true, status: sm ? Number(sm[1]) : null, headers };
}

// ----- per-source pollers (each returns a list of items with .status) -----

async function pollGhIssues() {
  const r = await sh("gh", [
    "issue", "list",
    "--repo", REPO,
    "--state", "all",
    "--limit", "100",
    "--json", "number,title,state,labels,url",
  ]);
  if (!r.ok) return { error: r.error, items: [] };
  let all;
  try { all = JSON.parse(r.stdout); } catch { return { error: "parse", items: [] }; }
  const wanted = new Set(UMBRELLA_ISSUES);
  return {
    items: all
      .filter(i => wanted.has(i.number))
      .map(i => ({
        number: i.number,
        title: i.title,
        state: i.state,
        url: i.url,
        labels: (i.labels || []).map(l => l.name),
      })),
  };
}

async function pollGhPrs() {
  const r = await sh("gh", [
    "pr", "list",
    "--repo", REPO,
    "--state", "open",
    "--limit", "50",
    "--json", "number,title,headRefName,url,isDraft,labels",
  ]);
  if (!r.ok) return { error: r.error, items: [] };
  let all;
  try { all = JSON.parse(r.stdout); } catch { return { error: "parse", items: [] }; }
  const filter = /going-national|cloud-sql|monitoring|rate-limit|national|cutover/i;
  return {
    items: all.filter(p =>
      filter.test(p.title) ||
      filter.test(p.headRefName) ||
      (p.labels || []).some(l => filter.test(l.name))
    ),
    total_open: all.length,
  };
}

async function pollRecentCommits() {
  const r = await sh("git", ["log", "--oneline", "origin/main", "-10"]);
  if (!r.ok) return { error: r.error, items: [] };
  return { items: r.stdout.split("\n").filter(Boolean) };
}

async function pollApiTtl() {
  const r = await curlHeaders("https://api.bird-maps.com/api/observations");
  if (!r.ok) return { status: "blocked", detail: r.error };
  const cc = r.headers["cache-control"] || "";
  const ok = /s-maxage=300/.test(cc);
  return {
    status: ok ? "done" : "blocked",
    httpStatus: r.status,
    cacheControl: cc,
    detail: ok ? "s-maxage=300 present" : `cache-control: ${cc || "(missing)"}`,
  };
}

async function pollFrontend() {
  const r = await curlHeaders("https://bird-maps.com/");
  if (!r.ok) return { status: "blocked", detail: r.error };
  return {
    status: r.status && r.status < 400 ? "done" : "blocked",
    httpStatus: r.status,
    detail: `HTTP ${r.status}`,
  };
}

async function pollUptimeChecks() {
  const r = await sh("gcloud", [
    "monitoring", "uptime", "list-configs",
    `--project=${GCP_PROJECT}`,
    "--format=value(displayName)",
  ]);
  if (!r.ok) return { status: "blocked", detail: r.stderr || r.error };
  const names = r.stdout.split("\n").filter(Boolean);
  return {
    status: names.length > 0 ? "done" : "not-started",
    count: names.length,
    detail: names.length ? `${names.length} uptime checks configured` : "none",
  };
}

async function pollSecret(name) {
  const r = await sh("gcloud", [
    "secrets", "versions", "list", name,
    `--project=${GCP_PROJECT}`,
    "--limit=1",
    "--format=value(name)",
  ]);
  if (!r.ok) return { name, status: "blocked", detail: r.stderr || r.error };
  return {
    name,
    status: r.stdout ? "done" : "not-started",
    detail: r.stdout ? "≥1 version" : "no versions",
  };
}

async function pollHealthcheckSecrets() {
  const items = await Promise.all(HEALTHCHECK_SECRETS.map(pollSecret));
  const ok = items.filter(i => i.status === "done").length;
  return {
    items,
    summary: `${ok}/${HEALTHCHECK_SECRETS.length} populated`,
    status: ok === HEALTHCHECK_SECRETS.length ? "done" : ok === 0 ? "not-started" : "in-flight",
  };
}

async function pollCloudSql() {
  const r = await sh("gcloud", [
    "sql", "instances", "describe", "birdwatch-pg16",
    `--project=${GCP_PROJECT}`,
    "--format=value(state)",
  ]);
  if (!r.ok) return { status: "blocked", detail: r.stderr || r.error };
  const state = r.stdout;
  return {
    status: state === "RUNNABLE" ? "done" : "in-flight",
    detail: `state=${state || "unknown"}`,
  };
}

// ----- phase model -----

function statusForIssue(issueByNumber, num) {
  const i = issueByNumber.get(num);
  if (!i) return { status: "not-started", detail: `#${num} not found` };
  if (i.state === "CLOSED") return { status: "done", detail: `#${num} closed`, url: i.url };
  return { status: "not-started", detail: `#${num} open`, url: i.url };
}

function buildPhases(snapshot) {
  const issuesByNumber = new Map((snapshot.issues.items || []).map(i => [i.number, i]));

  const prsTouching = (re) => snapshot.prs.items.filter(p => re.test(p.title) || re.test(p.headRefName));

  return [
    {
      id: "phase-0",
      title: "Phase 0 — pre-conditions to flip",
      items: [
        { name: "Prune job", status: "done", detail: "live (Cloud Scheduler)" },
        { name: "TTL caching", ...snapshot.apiTtl, detail: "verify s-maxage=300 on api.bird-maps.com — " + snapshot.apiTtl.detail },
        { name: "Rate-limit Layer 1 (CF edge)", status: "done", detail: "cloudflare_ruleset.read_api_rate_limit" },
        { name: "Rate-limit Layer 2 (WAF managed)", status: "user-action", detail: "manual CF dashboard step" },
        { name: "Rate-limit Layer 3 (Hono middleware)", status: "done", detail: "live in services/read-api" },
        { name: "Shape-2 probe", status: "done", detail: "GH Actions workflow live" },
        { name: "Monitoring code", status: "done", detail: "live" },
        { name: "Monitoring infra", ...snapshot.uptime, detail: "GCP alert policies — " + snapshot.uptime.detail },
        { name: "Healthchecks.io secrets", status: snapshot.healthchecks.status, detail: snapshot.healthchecks.summary, sub: snapshot.healthchecks.items },
        { name: "Workers Paid plan", status: "done", detail: "purchased" },
        { name: "Cloud SQL provisioned", ...snapshot.cloudSql, detail: "birdwatch-pg16 " + snapshot.cloudSql.detail },
        { name: "Cornell ToS email", status: "user-action", detail: "awaiting Julian send" },
      ],
    },
    {
      id: "phase-1",
      title: "Phase 1 — Cloud SQL cutover",
      items: [
        { name: "Stage 1 — provision", status: "done", detail: "merged" },
        { name: "Stage 2 — Auth Proxy mounts", status: "done", detail: "PR #615 merged" },
        { name: "T3 — operator dump+restore", status: "user-action", detail: "pending operator run" },
        { name: "Stage 3 — secret flip", status: "user-action", detail: "user-gated cutover" },
        { name: "Stage 4 — Neon teardown", status: "not-started", detail: "T+48h after Stage 3" },
      ],
    },
    {
      id: "phase-2",
      title: "Phase 2 — frontend + ingestor",
      items: [
        { name: "CONUS viewport", status: "done" },
        { name: "Region-table drop", status: "done" },
        { name: "iNat place_id", status: "done" },
        { name: "Phenology UTC", status: "done" },
        { name: "Silhouette colorDark", status: "done" },
        { name: "AZ branding sweep", ...statusForIssue(issuesByNumber, 533) },
        { name: "Server-side bbox filtering", status: "not-started", detail: "no issue / PR yet" },
      ],
    },
    {
      id: "phase-3",
      title: "Phase 3 — the flip",
      items: [
        { name: "regionCode US-AZ → US", status: "user-action", detail: "user-triggered flip" },
        { name: "Per-state backfill fan-out", status: "not-started", detail: "T+30d follow-up" },
      ],
    },
    {
      id: "phase-4",
      title: "Phase 4 — post-flip",
      items: [
        { name: "+7d cost review", status: "not-started" },
        { name: "+30d cost review", status: "not-started" },
      ],
    },
    {
      id: "umbrella-issues",
      title: "Umbrella issues",
      items: UMBRELLA_ISSUES.map(n => {
        const i = issuesByNumber.get(n);
        if (!i) return { name: `#${n}`, status: "blocked", detail: "not found via gh" };
        return {
          name: `#${n} ${i.title}`,
          status: i.state === "CLOSED" ? "done" : "not-started",
          detail: i.state,
          url: i.url,
        };
      }),
    },
    {
      id: "open-prs",
      title: "Open PRs (national / cloud-sql / monitoring)",
      items: snapshot.prs.items.length
        ? snapshot.prs.items.map(p => ({
            name: `#${p.number} ${p.title}`,
            status: p.isDraft ? "in-flight" : "in-flight",
            detail: p.isDraft ? "draft" : "open",
            url: p.url,
          }))
        : [{ name: "(none)", status: "done", detail: "no open PRs match filter" }],
    },
    {
      id: "recent-commits",
      title: "Recent commits on origin/main",
      items: (snapshot.commits.items || []).map(line => ({ name: line, status: "done" })),
    },
  ];
}

// ----- cache + polling loop -----

let cache = {
  startedAt: new Date().toISOString(),
  lastUpdated: null,
  lastError: null,
  nextPollAt: null,
  phases: [],
  raw: null,
};

async function pollAll() {
  const t0 = Date.now();
  const [issues, prs, commits, apiTtl, frontend, uptime, healthchecks, cloudSql] = await Promise.all([
    pollGhIssues(),
    pollGhPrs(),
    pollRecentCommits(),
    pollApiTtl(),
    pollFrontend(),
    pollUptimeChecks(),
    pollHealthcheckSecrets(),
    pollCloudSql(),
  ]);
  const snapshot = { issues, prs, commits, apiTtl, frontend, uptime, healthchecks, cloudSql };
  cache.phases = buildPhases(snapshot);
  cache.raw = snapshot;
  cache.lastUpdated = new Date().toISOString();
  cache.nextPollAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
  cache.lastError = null;
  cache.pollMs = Date.now() - t0;
  // Also surface api/frontend as their own top-level health pills
  cache.health = {
    api: { status: apiTtl.status, detail: apiTtl.detail },
    frontend: { status: frontend.status, detail: frontend.detail },
  };
}

async function pollLoop() {
  try { await pollAll(); }
  catch (e) { cache.lastError = e.message; }
  setTimeout(pollLoop, POLL_INTERVAL_MS);
}

// ----- server -----

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/api/status", (_req, res) => res.json(cache));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`national-dashboard listening on http://localhost:${PORT}`);
  pollLoop();
});
