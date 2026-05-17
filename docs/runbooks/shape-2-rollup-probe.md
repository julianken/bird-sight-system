# Runbook — Shape 2 Rollup Probe

The Shape 2 rollup probe (`.github/workflows/shape-2-rollup-probe.yml`)
re-runs Iterator 1's 9 curls weekly and asserts row counts fall inside
expected bands. See `docs/plans/2026-05-17-shape-2-rollup-probe.md` for
the design.

## When the probe fires

You will receive (1) a GitHub Actions workflow-failure email and (2) a
`drift:automated` issue. Follow the playbook in the issue body verbatim.

## Manual re-run

```
gh workflow run shape-2-rollup-probe --repo julianken/bird-sight-system
```

## Suppressing during eBird maintenance

```
gh workflow run shape-2-rollup-probe \
  --repo julianken/bird-sight-system \
  -f skip_alert_during_maintenance=true
```

The probe still runs and still appends to the CSV; only the issue
creation is suppressed.

## Re-tuning bands

After 12 months of clean data (~52 rows in the CSV), revisit
`scripts/shape-2-bands.json`. For each `band`-mode curl, compute P5 and
P95 across the 12-month history; new band = `[0.5 × P5, 1.5 × P95]`.
Land as a single-file PR.

## Cadence change (weekly → quarterly)

After spring 2027 (one full year covering both migration windows), edit
the cron in `.github/workflows/shape-2-rollup-probe.yml` from
`0 14 * * 1` to `0 14 1 1,4,7,10 *` (1st of Jan/Apr/Jul/Oct, 14:00 UTC).

## When the probe is dead (Shape 2 deprecated)

If a fire confirms the species-rollup contract is gone, file a follow-up
plan to re-cost the 50-state path under Shape 1, archive this workflow
(set `on: workflow_dispatch:` only, drop the cron), and add an addendum
to `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md`
Theme 2 / Opportunity O1.
