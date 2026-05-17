# Shape 2 Rollup-Probe (eBird `/data/obs/{region}/recent` Species-Rollup Contract Monitor)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax. This plan assumes zero prior context — every task lists exact file paths, full code, expected commands, and a commit-message template.

**Date:** 2026-05-17
**Author:** Julian (orchestrated)
**Sibling plan:** `docs/plans/2026-05-17-monitoring-and-alerts.md` §"Shape 2 re-sample probe"
**Open question resolved:** O2 in `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md`

**Goal:** Detect — within one week — any change to the undocumented species-rollup behavior of `/data/obs/{region}/recent`. Shape 2's entire 50-state cost story (~2 calls/day vs ~6,400 calls/day) depends on this endpoint returning **one row per species** rather than one row per observation. The behavior is undocumented; Cornell has made no commitment about it; the supporting evidence is 9 curls executed inside a single calendar day during spring migration. If the behavior silently degrades to per-observation (a low-volume quirk that only held at quiet hours; or a Cornell-side change without notice), Shape 2 collapses to Shape 1 and the 50-state expansion path needs re-costing.

**Architecture:** A scheduled **GitHub Actions** workflow re-runs Iterator 1's exact 9 curls on a weekly cadence through fall migration (Sep–Oct 2026), then quarterly indefinitely after. Each curl's row count is compared against a per-curl expected band (anchored on Iterator 1's measurements ± a generous spring↔fall migration margin). Any band miss fails the workflow, which (a) creates a GitHub Issue via `gh issue create` and (b) surfaces in the workflow's standard "failed run" email — which the operator (`julian.kennon.d@gmail.com`) already receives via GitHub's default notification settings on `julianken/bird-sight-system`. Output history is committed back to the repo as a CSV append in `docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv`. No new infra; no Cloud Run; no Terraform.

**Tech stack:** GitHub Actions (`ubuntu-latest`); `curl`; `jq`; `gh` CLI (pre-installed on the runner) for issue creation; the existing `EBIRD_KEY` secret already provisioned for CI (per the monitoring plan's confirmation that the key is a CI secret).

---

## Background and motivation

Iterator 1 of the May 2026 analysis funnel ran 9 live curls against `/data/obs/{region}/recent` and discovered that the endpoint returns one row per species (the latest sighting), not one row per observation. This is the single most consequential architecture insight from the funnel: a `/data/obs/US/recent?back=1` call returns ~683 records covering the entire continental US — fewer than a single state's worth of observations at peak migration. The 50-state expansion path that previously looked like a 50× fan-out collapses to a single call.

The dissent lens (Risk C2 / Dissent D1 in `phase-3/synthesis-2-risk-opportunity.md`) pushed back: HIGH confidence rests on a 1-day sample in a non-peak migration window. Two failure modes are conceivable:

1. **Low-volume quirk.** During quiet hours / spring migration, observation counts are bounded enough that a server-side rollup happens transparently. At peak fall migration, when single species can generate hundreds of observations in an hour, the endpoint returns the unrolled list. Shape 2's call profile spikes; we don't notice until the next eBird ToS review.
2. **Cornell changes the behavior with no SLA.** The species-rollup semantic is undocumented (eBird's API docs describe `/recent` as returning "recent observations", not "most recent observation per species"). Cornell can change the implementation tomorrow without breaking any documented contract.

The probe's job is to make **either failure mode loud within one week of occurrence**, while it is still cheap to revert (drop back to per-state fan-out, re-cost, accept the band shift).

### Resolved design decisions (plan invariants)

1. **GitHub Actions, not Cloud Run + Scheduler.** The monitoring plan resolved this in §"Shape 2 re-sample probe": different cadence (weekly), different signal (boolean assertion over a fixed 9-call output), different infra surface (CI, not GCP). Re-justified here because it's the load-bearing infra decision of this plan:
   - The eBird API key already exists as a GitHub Actions secret (no new secret-management surface).
   - GitHub Actions ships failure-email-on-workflow-fail to repository admins by default (no new notification channel needed).
   - The probe's assertion is shape over a JSON response — a plain `jq | wc -l` per curl. Cloud Monitoring uptime checks cannot express row-count thresholds; building a custom Cloud Run Job would be ~10× the surface for the same signal.
   - The probe has no runtime dependency on production infra (no DB read, no Cloud Run hit). Decoupling it from the production GCP project is a feature: a GCP outage cannot mask a Cornell-side contract break.
2. **Weekly during fall migration; quarterly indefinitely after.** Migration is the worst-case load on the species-rollup semantic. After one full year of weekly green probes through both migration windows (spring 2027), drop to quarterly. The cron is editable in one file; the cadence change is a one-line PR.
3. **Regression = row count exceeds 2× the expected species cardinality for that region.** Detailed under §"What 'regression' means precisely" below. The 2× multiplier is calibrated against the highest single-day species count observed by eBird's published year-end totals (~10% intra-day variance in healthy species cardinality, well within 2×). Below 2× is noise; above 2× is structurally per-observation.
4. **History storage: CSV committed to the repo.** Each probe run appends one row to `docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv`. Reasons: (a) free, (b) auditable in `git log`, (c) re-graphable any time without a DB query, (d) survives this repo's full toolchain rewrite. A gist would be lighter but harder to discover; a Cloud SQL table is wrong-shape (the data is fundamentally append-only, never queried by the application). The CSV is ≤56 rows/year — under 5 KB after a decade. Not a repo-bloat risk.
5. **Alert mechanism: workflow-fail email + GitHub Issue.** The monitoring plan provisions a single email channel for Cloud Monitoring alerts (`julian.kennon.d@gmail.com`). This probe lives outside Cloud Monitoring's surface; GitHub Actions already mails workflow-fail to the repository admin. Filing a `drift:automated`-labeled issue gives the failure a tracked artifact that aging/escalation workflows pick up (see drift taxonomy in `CLAUDE.md`).
6. **No CI gating.** The probe workflow is **not** in the Mergify queue gate (`test`, `lint`, `build`, `e2e`). It runs on a schedule, not on PRs. A red probe blocks no PRs; it just emails the operator.

---

## The 9 curls (verbatim from Iterator 1) and expected row-count bands

Source: `docs/analyses/2026-05-14-process-scale-options/phase-2/iterator-1-rollup-verification.md` lines 201–212.

| # | Curl | Iterator-1 count (2026-05-14) | Expected band | Band rationale |
|---|---|---|---|---|
| 1 | `GET /v2/data/obs/US/recent?back=1&maxResults=10000` | 683 | 400–1400 | US has ~700 species typically reported intra-day; fall migration peak adds boreal migrants but the all-time intra-day max from eBird year totals is ~900. 2× upper bound (1400) catches per-observation drift; lower bound 400 catches "endpoint broken / empty" failures. |
| 2 | `GET /v2/data/obs/US/recent?back=1&maxResults=100` | 100 | exactly 100 | This curl tests the `maxResults` cap behavior. As long as US has >100 species reported intra-day (always true), this returns exactly 100. Deviation = endpoint semantics changed. |
| 3 | `GET /v2/data/obs/US-AZ/recent?back=1&maxResults=5&detail=full` | 5 | exactly 5 | Same `maxResults` cap test, at state scope, with `detail=full` schema. Confirms the cap is independent of region scope and detail level. |
| 4 | `GET /v2/data/obs/US-CA/recent?back=1&maxResults=5` | 5 | exactly 5 | Mirror of #3 without `detail=full`; confirms detail flag doesn't change cap. |
| 5 | `GET /v2/data/obs/US-CA/recent?back=1&maxResults=10000` | 304 | 200–700 | CA has ~500–600 species reported intra-day at peak migration; 2× upper bound (700) catches per-observation drift. Lower bound 200 catches partial outage. |
| 6 | `GET /v2/data/obs/US-AZ/recent?back=1&maxResults=10000` | 237 | 150–550 | AZ has ~400 species reported intra-day at peak; 2× upper bound (550) catches drift. |
| 7 | `GET /v2/data/obs/US-WY/recent?back=1&maxResults=10000` | 150 | 80–400 | WY has ~250 species reported intra-day at peak; 2× upper bound (400) catches drift. WY is the low-volume control — if WY suddenly returns 1000+ records, the rollup is definitively gone. |
| 8 | `GET /v2/data/obs/US/recent?back=14&maxResults=10000` | 859 | 600–1800 | 14-day window captures more transient species. 2× upper bound (1800) is the per-observation alarm: US at `back=14` would return tens of thousands of observations if rollup broke. |
| 9 | `GET /v2/data/obs/US-AZ/recent?back=14&maxResults=10000` | 360 | 250–800 | AZ verification call at production-ingestor parameters (`back=14&maxResults=10000` is exactly what `services/ingestor/src/ebird/client.ts:31–46` issues per cron tick). 2× upper bound (800) catches drift in the actual production call shape. |

**Band derivation note.** Iterator 1's measurements come from a single quiet-hour sample on 2026-05-14 (mid-spring migration, not peak fall). The lower bounds are set generously below Iterator-1 measurements to avoid false-positive fires from legitimate quiet-period reporting dips; the upper bounds are set at 2× the expected species cardinality for the region (anchored on eBird's year-end species totals at the relevant geographic scope, not on Iterator 1's measurements). The 2× multiplier explicitly bakes in fall-migration headroom — if fall 2026's first probe lands at 1.5× spring 2026 for one of the rollup calls, that's the expected migration enhancement and the band absorbs it without firing.

After 12 months of probe data, bands get re-tuned in a follow-up PR (Task 7).

---

## Output schema

Each workflow run appends one row to `docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv`:

```
ts,curl_1_us_back1,curl_2_us_back1_max100,curl_3_us_az_back1_max5_full,curl_4_us_ca_back1_max5,curl_5_us_ca_back1_max10k,curl_6_us_az_back1_max10k,curl_7_us_wy_back1_max10k,curl_8_us_back14,curl_9_us_az_back14,all_pass
2026-05-17T14:02:11Z,683,100,5,5,304,237,150,859,360,true
```

- `ts` is ISO 8601 UTC.
- Each `curl_N_*` column is the integer row count for that curl.
- `all_pass` is `true` iff every curl's count falls inside its expected band.

The workflow's final job-level output is the `all_pass` boolean and the per-curl counts as a JSON blob in the workflow summary. A `false` `all_pass` fails the workflow step (which fires the standard GitHub Actions failure-email and triggers the issue-creation step).

---

## Alert mechanism

Two-channel, both free, both already-existing surfaces:

1. **GitHub Actions workflow-failure email.** GitHub Actions mails the repository admin on any workflow failure by default. `julian.kennon.d@gmail.com` is already the admin email on `julianken/bird-sight-system`; no new notification channel to provision. The email subject is `[julianken/bird-sight-system] Run failed: shape-2-rollup-probe`. Inbox-level filter rules can prioritize this subject if signal volume grows.
2. **GitHub Issue with `drift:automated`, `ingest`, `o2-probe` labels.** On any `all_pass=false`, the workflow's final step calls `gh issue create` with the per-curl counts table, the expected bands, the probe-history CSV link, and a body template instructing the operator through the playbook below. The `drift:automated` label routes the issue through the existing drift-aging workflow (`drift:aging` after 14 days, `drift:escalated` after 30 — see `CLAUDE.md` "Drift detection"); the SessionStart hook surfaces `drift:escalated` issues at higher priority next session.

**Why not tie into the monitoring plan's `google_monitoring_notification_channel`?** That channel lives in GCP Cloud Monitoring and is wired only to Cloud Monitoring alert policies. There's no clean way to fire a Cloud Monitoring alert from a GitHub Actions step without a custom-metric write (which routes the signal through the same GCP failure surface we explicitly decoupled from in §"Resolved design decisions" item 1). The monitoring plan's email channel and this probe's email channel happen to both land in the same inbox — that's the operator-facing equivalence — but the wires are deliberately separate so a GCP outage doesn't mask a Cornell-side contract break.

---

## What "regression" means precisely

A single curl fails its band if `count < lower_bound OR count > upper_bound`. The workflow fails if **any** of the 9 curls fail their band.

**False-positive avoidance.** Three guards apply before `gh issue create` fires:

1. **Retry once after 60s.** Each curl is retried once after a 60-second delay if its first response is non-200, has an unexpected JSON shape (e.g. `[]` when we expect records), or has a row count outside its band. This absorbs eBird-side transient 5xx, brief rate-limit signals, and eBird-side internal-deploy windows. Both attempts are recorded in the workflow log; only the second-attempt result is written to the CSV. If both attempts miss the band, that's a real signal — not a flaky network.
2. **All-or-none for low-cardinality curls.** Curls #2, #3, #4 expect exact counts (100, 5, 5). If any of these three deviates, that alone fires regardless of the others, because deviation here means `maxResults` semantics changed and that's a different failure class than band-violation on the larger curls.
3. **No firing during eBird-announced maintenance.** A manual workflow-dispatch input (`skip_alert_during_maintenance: boolean`) lets the operator suppress issue creation for a single run if eBird has pre-announced downtime. Default `false`; the operator flips it via the GitHub UI before the cron next fires.

**Regression vs. natural variance.** The 2× upper-band multiplier explicitly accommodates the spring↔fall migration enhancement (eBird year totals show ~15% peak intra-day species count growth, not 2×). A band miss on curls 1, 5, 6, 7, 8, or 9 is therefore **not** "fall migration is bigger" — it is "the endpoint is returning observations rather than species rollups". The lower bands are set generously low (40–60% of Iterator-1 measurements) so a quiet-period dip doesn't fire; the operator sees the dip in the committed CSV and can manually verify.

---

## Playbook: what to do when the probe fires

The issue body (auto-generated by the workflow) includes this playbook verbatim:

1. **Re-run manually.** Click "Re-run failed jobs" on the workflow page. If the retry passes, close the issue with comment `Transient — retry green at <ts>`. The CSV row from the original fire stays in history as a data point.
2. **If retry fails:** check eBird's API changelog (`https://documenter.getpostman.com/view/664302/S1ENwy59`) and the eBird forum (`https://groups.io/g/ebird-api`) for any announcement of `/data/obs/{region}/recent` behavior change in the last 7 days.
3. **If no announcement:** post to the eBird forum asking whether the species-rollup behavior on `/data/obs/{region}/recent` has changed (template subject: "Behavior change on /data/obs/{region}/recent — single-row-per-species vs all observations?"). Include the per-curl counts table from the issue. **Do NOT email `ebird@cornell.edu` first** — the forum gets a faster response and a more authoritative one (Cornell devs read it).
4. **If forum confirms a deliberate change:** Shape 2 is dead. File a follow-up plan to re-cost the 50-state path under Shape 1 (per-state fan-out). The cost band shifts per `phase-3/synthesis-2-risk-opportunity.md` Opportunity O1: ~$30–80/mo at 50-state under Shape 2 → ~$200–400/mo under Shape 1 fan-out, plus the ToS/rate-limit surface area Iterator 1 thought we'd eliminated. The audit at `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md` Theme 2 / Opportunity O1 needs an addendum.
5. **If forum confirms no change and counts are still off:** the failure mode is the dissent lens's "low-volume quirk" hypothesis (item 1 in §"Background"). The behavior held at quiet hours but degrades at peak migration. Same Shape 2 → Shape 1 outcome as step 4; same cost-band re-frame; same audit addendum. The forum thread becomes evidence for the audit addendum either way.

The issue is closed with one of: `false-positive (retry green)`, `eBird-announced contract change`, `forum-confirmed silent change`, or `shape-2-deprecated` (linking the follow-up plan).

---

## File structure

| Path | Disposition | Responsibility |
|---|---|---|
| `.github/workflows/shape-2-rollup-probe.yml` | Create | Scheduled workflow: runs the 9 curls, evaluates bands, appends CSV, files issue on fail. |
| `scripts/shape-2-probe.sh` | Create | The probe itself: 9 curls + 9 band evaluations + CSV append. Bash so the workflow YAML stays small and the logic is testable in isolation. |
| `scripts/shape-2-bands.json` | Create | The 9 band definitions (low, high, exact-mode flag). One file so re-tuning bands is a one-file PR. |
| `docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv` | Create (empty header row) | History of per-run counts. Append-only via the workflow. |
| `docs/runbooks/shape-2-rollup-probe.md` | Create | Operator runbook: how to interpret a fire, how to manually re-run, how to re-tune bands after a year of data. Includes the playbook above verbatim. |
| `docs/plans/2026-05-17-shape-2-rollup-probe.md` | Create | This plan. |

---

## Critical-path checkpoints

1. **Probe script + bands file** (Task 1). Pure shell + JSON. Testable locally with the operator's `EBIRD_KEY` exported.
2. **Workflow YAML** (Task 2). Wires the script into GitHub Actions; cron + secret; issue-create on fail.
3. **First green run** (Task 3). Operator dispatches the workflow manually (`workflow_dispatch`); verifies the CSV row lands; verifies the workflow summary shows `all_pass=true`. Marks 2026-05-17 as the baseline.
4. **Runbook + sibling-plan cross-link** (Task 4). Updates the monitoring plan's reference to point to this file and to the workflow file.

---

## Task breakdown

### Task 1 — `feat(probe): shape-2 rollup probe script and bands`

- [ ] **Read** `docs/analyses/2026-05-14-process-scale-options/phase-2/iterator-1-rollup-verification.md` lines 197–214 for the canonical 9 curls.
- [ ] **Create** `scripts/shape-2-bands.json`:

```json
{
  "curls": [
    { "id": 1, "name": "us_back1",            "path": "/v2/data/obs/US/recent?back=1&maxResults=10000",                       "mode": "band",  "low":  400, "high": 1400 },
    { "id": 2, "name": "us_back1_max100",     "path": "/v2/data/obs/US/recent?back=1&maxResults=100",                         "mode": "exact", "value": 100 },
    { "id": 3, "name": "us_az_back1_max5_full","path": "/v2/data/obs/US-AZ/recent?back=1&maxResults=5&detail=full",            "mode": "exact", "value": 5 },
    { "id": 4, "name": "us_ca_back1_max5",    "path": "/v2/data/obs/US-CA/recent?back=1&maxResults=5",                        "mode": "exact", "value": 5 },
    { "id": 5, "name": "us_ca_back1_max10k",  "path": "/v2/data/obs/US-CA/recent?back=1&maxResults=10000",                    "mode": "band",  "low":  200, "high":  700 },
    { "id": 6, "name": "us_az_back1_max10k",  "path": "/v2/data/obs/US-AZ/recent?back=1&maxResults=10000",                    "mode": "band",  "low":  150, "high":  550 },
    { "id": 7, "name": "us_wy_back1_max10k",  "path": "/v2/data/obs/US-WY/recent?back=1&maxResults=10000",                    "mode": "band",  "low":   80, "high":  400 },
    { "id": 8, "name": "us_back14",           "path": "/v2/data/obs/US/recent?back=14&maxResults=10000",                      "mode": "band",  "low":  600, "high": 1800 },
    { "id": 9, "name": "us_az_back14",        "path": "/v2/data/obs/US-AZ/recent?back=14&maxResults=10000",                   "mode": "band",  "low":  250, "high":  800 }
  ]
}
```

- [ ] **Create** `scripts/shape-2-probe.sh`:

```bash
#!/usr/bin/env bash
# Shape-2 rollup-probe: re-runs Iterator 1's 9 curls against
# /data/obs/{region}/recent and asserts each row count falls inside an
# expected band. See docs/plans/2026-05-17-shape-2-rollup-probe.md.
#
# Inputs:
#   $EBIRD_KEY           — required, eBird API key (GitHub Actions secret).
#   $HISTORY_CSV         — optional path to append a row to; default
#                          docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv
# Output:
#   $GITHUB_OUTPUT       — writes all_pass=true|false and counts_json=<...>
#                          when running under GitHub Actions; harmless locally.
# Exit:
#   0 if all 9 curls pass their band; 1 otherwise.

set -euo pipefail

BANDS_FILE="$(dirname "$0")/shape-2-bands.json"
HISTORY_CSV="${HISTORY_CSV:-docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv}"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -z "${EBIRD_KEY:-}" ]]; then
  echo "EBIRD_KEY not set" >&2
  exit 2
fi

fetch_count() {
  # Issues a single curl, returns the JSON-array length. Retries once after
  # 60s on non-200 or non-array body.
  local path="$1"
  local attempt
  for attempt in 1 2; do
    local body
    body=$(curl -sS -H "X-eBirdApiToken: $EBIRD_KEY" "https://api.ebird.org${path}" || echo '')
    local count
    count=$(echo "$body" | jq 'if type == "array" then length else -1 end' 2>/dev/null || echo -1)
    if [[ "$count" -ge 0 ]]; then
      echo "$count"
      return 0
    fi
    if [[ $attempt -eq 1 ]]; then sleep 60; fi
  done
  echo -1
}

declare -a counts
all_pass=true
n=$(jq '.curls | length' "$BANDS_FILE")
for i in $(seq 0 $((n - 1))); do
  path=$(jq -r ".curls[$i].path"  "$BANDS_FILE")
  mode=$(jq -r ".curls[$i].mode"  "$BANDS_FILE")
  name=$(jq -r ".curls[$i].name"  "$BANDS_FILE")
  c=$(fetch_count "$path")
  counts+=("$c")
  if [[ "$mode" == "exact" ]]; then
    want=$(jq -r ".curls[$i].value" "$BANDS_FILE")
    if [[ "$c" -ne "$want" ]]; then
      echo "FAIL curl $((i+1)) $name: got $c, want exactly $want" >&2
      all_pass=false
    else
      echo "PASS curl $((i+1)) $name: $c"
    fi
  else
    low=$(jq -r  ".curls[$i].low"  "$BANDS_FILE")
    high=$(jq -r ".curls[$i].high" "$BANDS_FILE")
    if [[ "$c" -lt "$low" || "$c" -gt "$high" ]]; then
      echo "FAIL curl $((i+1)) $name: got $c, want [$low..$high]" >&2
      all_pass=false
    else
      echo "PASS curl $((i+1)) $name: $c in [$low..$high]"
    fi
  fi
done

# Append CSV row (works locally and in CI).
row="$TS"
for c in "${counts[@]}"; do row="$row,$c"; done
row="$row,$all_pass"
mkdir -p "$(dirname "$HISTORY_CSV")"
if [[ ! -f "$HISTORY_CSV" ]]; then
  echo "ts,curl_1_us_back1,curl_2_us_back1_max100,curl_3_us_az_back1_max5_full,curl_4_us_ca_back1_max5,curl_5_us_ca_back1_max10k,curl_6_us_az_back1_max10k,curl_7_us_wy_back1_max10k,curl_8_us_back14,curl_9_us_az_back14,all_pass" > "$HISTORY_CSV"
fi
echo "$row" >> "$HISTORY_CSV"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "all_pass=$all_pass" >> "$GITHUB_OUTPUT"
  printf 'counts_json=[%s]\n' "$(IFS=,; echo "${counts[*]}")" >> "$GITHUB_OUTPUT"
fi

if [[ "$all_pass" == "true" ]]; then exit 0; else exit 1; fi
```

- [ ] **Make executable:** `chmod +x scripts/shape-2-probe.sh`.
- [ ] **Local smoke (operator only, with `EBIRD_KEY` exported):**

```sh
EBIRD_KEY=$(gcloud secrets versions access latest --secret=bird-watch-ebird-key --project=bird-maps-prod) \
  ./scripts/shape-2-probe.sh
```

Expect: 9 PASS lines, a new CSV row in `docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv`, exit 0.

- [ ] **Create empty CSV with header row** if the script's first-run header-write hasn't already happened: `touch docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv && head -n 1 ...` — the script writes the header on first run, so this step is just to make the file present in the commit before the workflow lands. Alternatively, run the script locally once and commit the file with one data row.
- [ ] **Commit:**

```
feat(probe): shape-2 rollup probe script and bands

scripts/shape-2-probe.sh runs Iterator 1's 9 curls against
/data/obs/{region}/recent and asserts each row count is inside an
expected band (scripts/shape-2-bands.json). One CSV row per run goes
to docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv.

Resolves Open Question O2 from
docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md.
```

### Task 2 — `ci(probe): schedule shape-2 rollup probe weekly`

- [ ] **Create** `.github/workflows/shape-2-rollup-probe.yml`:

```yaml
name: shape-2-rollup-probe

on:
  schedule:
    # Every Monday 14:00 UTC. Weekly through fall migration (Sep-Oct 2026);
    # cadence drops to quarterly in 2027 per the plan re-tuning task.
    - cron: '0 14 * * 1'
  workflow_dispatch:
    inputs:
      skip_alert_during_maintenance:
        description: 'If true, do not file an issue on band miss this run.'
        type: boolean
        default: false

permissions:
  contents: write    # append the CSV
  issues:  write     # file the alert issue on fail

jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run probe
        id: probe
        env:
          EBIRD_KEY: ${{ secrets.EBIRD_KEY }}
        run: ./scripts/shape-2-probe.sh
        continue-on-error: true
      - name: Commit probe-history CSV
        if: always()
        run: |
          set -euo pipefail
          git config user.name  'github-actions[bot]'
          git config user.email 'github-actions[bot]@users.noreply.github.com'
          git add docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv
          if ! git diff --cached --quiet; then
            git commit -m "chore(probe): o2 probe run $(date -u +%Y-%m-%d)"
            git push
          fi
      - name: File issue on band miss
        if: steps.probe.outcome == 'failure' && inputs.skip_alert_during_maintenance != true
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          gh issue create \
            --title "drift(o2-probe): Shape 2 rollup contract band miss $(date -u +%Y-%m-%d)" \
            --label drift:automated,ingest,o2-probe \
            --body "$(cat <<'EOF'
          ## Shape 2 rollup-probe band miss

          The weekly probe of `/data/obs/{region}/recent` returned at least one
          row count outside its expected band. See
          [the workflow run]($GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID)
          for per-curl details and
          [the probe-history CSV](../blob/main/docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv)
          for trend data.

          ## Playbook

          1. **Re-run manually.** Click "Re-run failed jobs" on the workflow.
             If it passes, close this issue with `false-positive (retry green)`.
          2. **If retry fails:** check eBird's API changelog
             (https://documenter.getpostman.com/view/664302/S1ENwy59) and the
             eBird forum (https://groups.io/g/ebird-api) for `/recent` behavior
             changes in the last 7 days.
          3. **If no announcement:** post to the eBird forum (subject:
             "Behavior change on /data/obs/{region}/recent — single-row-per-species
             vs all observations?"). Include per-curl counts.
          4. **If forum confirms a deliberate change OR counts stay off:** Shape
             2 is dead. File a follow-up plan to re-cost the 50-state path under
             Shape 1. See
             `docs/plans/2026-05-17-shape-2-rollup-probe.md` §"Playbook" steps
             4–5.

          Close with: `false-positive (retry green)`, `eBird-announced contract
          change`, `forum-confirmed silent change`, or `shape-2-deprecated`.
          EOF
          )"
      - name: Fail job if probe failed and not in maintenance mode
        if: steps.probe.outcome == 'failure' && inputs.skip_alert_during_maintenance != true
        run: exit 1
```

- [ ] **Verify the workflow file is valid YAML:** `gh workflow view shape-2-rollup-probe` will work once the file lands on `main`; before then, `yq '.' .github/workflows/shape-2-rollup-probe.yml` or local `actionlint` is sufficient.
- [ ] **Confirm `EBIRD_KEY` is a configured GitHub Actions secret:**
  `gh secret list --repo julianken/bird-sight-system | grep EBIRD_KEY`. If not present, provision via:
  `gh secret set EBIRD_KEY --repo julianken/bird-sight-system --body "$(gcloud secrets versions access latest --secret=bird-watch-ebird-key --project=bird-maps-prod)"`.
- [ ] **Commit:**

```
ci(probe): schedule shape-2 rollup probe weekly

Adds .github/workflows/shape-2-rollup-probe.yml — cron 0 14 * * 1
(Mondays 14:00 UTC). On any curl-band miss, the workflow appends to
the probe-history CSV, files a drift:automated issue with the operator
playbook, and fails the run (which sends a workflow-fail email to the
repo admin). workflow_dispatch input skip_alert_during_maintenance
lets the operator suppress the issue during eBird-announced downtime.
```

### Task 3 — `chore(probe): baseline run on 2026-05-17`

- [ ] **Manually dispatch the workflow:**
  `gh workflow run shape-2-rollup-probe --repo julianken/bird-sight-system`
- [ ] **Wait for completion; verify:**
  - The workflow ends green.
  - One row appended to `o2-probe-history.csv` with `all_pass=true`.
  - The 9 counts are within an order of magnitude of Iterator 1's measurements (counts will not be identical because eBird's `/recent` is intra-hour-fresh; a few hundred ± a few dozen is normal).
- [ ] **If `all_pass=false` on the very first run:** investigate before the cron fires next Monday. The expected-band table in the plan may need a one-line tune; OR the contract has already shifted in the 3 days between Iterator 1 and this baseline (unlikely but possible).
- [ ] **Commit (if any local edits to bands needed):**

```
chore(probe): tune shape-2 expected bands after baseline run

Baseline run on 2026-05-17 showed curl <N> at <count>, slightly
outside the initial band. Widened band from [<lo>..<hi>] to
[<new_lo>..<new_hi>]. CSV row from baseline retained for audit.
```

### Task 4 — `docs(probe): runbook and sibling-plan cross-link`

- [ ] **Create** `docs/runbooks/shape-2-rollup-probe.md`:

```markdown
# Runbook — Shape 2 Rollup Probe

The Shape 2 rollup probe (`.github/workflows/shape-2-rollup-probe.yml`)
re-runs Iterator 1's 9 curls weekly and asserts row counts fall inside
expected bands. See `docs/plans/2026-05-17-shape-2-rollup-probe.md` for
the design.

## When the probe fires

You will receive (1) a GitHub Actions workflow-failure email and (2) a
drift:automated issue. Follow the playbook in the issue body verbatim.

## Manual re-run

`gh workflow run shape-2-rollup-probe --repo julianken/bird-sight-system`

## Suppressing during eBird maintenance

`gh workflow run shape-2-rollup-probe -f skip_alert_during_maintenance=true`

The probe still runs and still appends to the CSV; only the issue-
creation is suppressed.

## Re-tuning bands

After 12 months of clean data (~52 rows in the CSV), revisit
`scripts/shape-2-bands.json`. For each `band`-mode curl, compute
P5 and P95 across the 12-month history; new band = [0.5 × P5,
1.5 × P95]. Land as a single-file PR.

## Cadence change (weekly → quarterly)

After spring 2027 (one full year covering both migration windows),
edit the cron in `.github/workflows/shape-2-rollup-probe.yml` from
`0 14 * * 1` to `0 14 1 1,4,7,10 *` (1st of Jan/Apr/Jul/Oct, 14:00 UTC).

## When the probe is dead (Shape 2 deprecated)

If a fire confirms the species-rollup contract is gone, file a follow-
up plan to re-cost the 50-state path under Shape 1, archive this
workflow (set `on: workflow_dispatch:` only, drop the cron), and add
an addendum to
`docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md`
Theme 2 / Opportunity O1.
```

- [ ] **Edit** `docs/plans/2026-05-17-monitoring-and-alerts.md` §"Shape 2 re-sample probe (sibling plan)" — replace the "the sibling plan stub" bullets with a one-line cross-reference: `Implemented in docs/plans/2026-05-17-shape-2-rollup-probe.md (workflow file: .github/workflows/shape-2-rollup-probe.yml).` Keep the surrounding rationale intact.
- [ ] **Commit:**

```
docs(probe): runbook and monitoring-plan cross-link

docs/runbooks/shape-2-rollup-probe.md gives the operator the manual
re-run command, the maintenance-suppression flag, the band re-tuning
procedure, and the cadence-change path. Monitoring plan's sibling-
plan section now points to this plan instead of restating its stub.
```

---

## Sequencing

1. Branch `plan/shape-2-rollup-probe` off `main` for the plan itself (this file). Doc-only PR; merge first so subsequent task PRs can reference it.
2. Task 1 — probe script + bands + baseline CSV (one PR). CI green (no app changes; the new shell script doesn't run on PRs).
3. Task 2 — workflow YAML (one PR). CI green; the workflow runs on schedule only, not on PR open. The first scheduled run is the next Monday 14:00 UTC.
4. Task 3 — manual baseline dispatch by the operator immediately after Task 2 merges. No PR; result is a CSV-row commit by `github-actions[bot]`.
5. Task 4 — runbook + monitoring-plan cross-link (one PR).

Total wall-clock: ~1.5h split across 3-4 PRs.

---

## Cost

GitHub Actions free tier on a public repo: unlimited minutes. The probe is 9 curls × <2s each + ~10s of shell overhead = ~30s per weekly run = ~26 minutes/year. Comfortably free.

eBird API: 9 calls/week = 468/year. eBird's informal sustained-rate limit is "a few requests per second"; this is rounding error against the ingestor's own ~115 calls/day production traffic.

CSV growth: 52 rows/year × ~100 bytes/row = ~5 KB/year. Negligible.

**Projected total cost: $0.00 indefinitely.**

---

## Open decisions (require Julian sign-off before execution)

### D1. Forum-first vs. email-Cornell-first when the probe fires

**Recommendation: forum first.** Faster response; Cornell devs read the forum directly; the public thread becomes searchable evidence for the audit addendum. Email Cornell only if the forum thread gets no Cornell-side response within 7 days.

### D2. CSV history in-repo vs. gist

**Recommendation: in-repo.** Discoverable from `docs/analyses/`; survives toolchain rewrites; auditable via `git log`. The 5 KB/year growth is not a repo-bloat risk.

### D3. Issue labels

**Recommendation: `drift:automated`, `ingest`, `o2-probe`.** Routes through the existing drift-aging workflow; the `o2-probe` label gives the SessionStart hook a precise filter for "did the contract probe fire recently?"

### D4. Cadence after one year of green

**Recommendation: drop weekly → quarterly after spring 2027.** One full year covering both migration windows is enough confidence that the contract is stable. Earlier cadence drops risk masking a slow-onset behavior change. Quarterly indefinitely after.

---

## Honest open items

- **Iterator-1 bands are anchored on a single calendar day.** Bands could be slightly mis-calibrated; the first 8 weeks of probe data will reveal whether any band is too tight (false-positive fires) or too loose (any drift that wouldn't fire). Task 3 covers the immediate first-run case; Task 4's runbook documents the re-tuning procedure for the medium term.
- **eBird could throttle 9-curl batches.** Empirically the bursts run in <20s without rate-limit signals (Iterator 1's full sample). If they start failing at the rate-limit layer, pace the curls with a 10s sleep between each — adds 80s to the run, still under a minute.
- **GitHub Actions schedule drift.** GitHub doesn't guarantee cron precision; runs can be delayed by minutes-to-hours under load. For a weekly contract probe, this is irrelevant. Documented here for the next-question case.
- **No automatic action on a fire.** The probe surfaces the signal; the operator decides what to do. There is no production code that switches from Shape 2 to Shape 1 automatically, because (a) the cost of an incorrect auto-switch (per-state fan-out at full 50-state scale = ~6,400 calls/day, immediate ToS exposure) is higher than the cost of a one-week delay in human decision-making, and (b) Shape 2 isn't deployed yet anyway — this probe is preventive for the 50-state migration, not reactive for live traffic.

---

## Methodology

Plan produced by a single-pass agentic write-up off three inputs: (1) `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md` Open Question O2; (2) `docs/analyses/2026-05-14-process-scale-options/phase-2/iterator-1-rollup-verification.md` for the canonical 9 curls and baseline counts; (3) `docs/plans/2026-05-17-monitoring-and-alerts.md` §"Shape 2 re-sample probe" for the fold-vs-sibling decision and the infra-surface justification. No multi-pass critic loop — the surface is small (one workflow, one shell script, one bands JSON), and the only judgment-laden content is the band thresholds, which are explicitly re-tunable in a one-file PR after baseline data lands.
