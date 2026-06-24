---
name: map-consistency-audit
description: >-
  Use when running or interpreting the bird-maps.com prod consistency audit, or
  dispatching the map-consistency-auditor agent. Triggers on "map consistency
  audit", "audit the map", "check bird counts", "filter numbers don't add up",
  "birds disappear at zoom", "desktop pills vanish". Encodes the metamorphic
  relation catalog, the carve-outs that prevent false positives, the Cloudflare
  pacing rules, the two-stage hash-wait, and the confirm-first triage flow.
---

# Map consistency audit

Metamorphic-testing harness that samples bird-maps.com at a configurable count,
walks a zoom ladder on desktop + mobile, and emits a preserved findings brief.
Full design: `.claude/skills/map-consistency-audit/DESIGN.md`.

## Run it
`npm run audit:map-consistency -w @bird-watch/frontend -- --samples N --scope US --seed K`
Flags: `--samples` (size), `--scope US|US-XX`, `--seed`, `--zoom-ladder`,
`--viewports desktop,mobile`, `--pace-ms` (default 2500), `--base-url` (default prod).
Probe one view: `... -- --probe '<#map= url>'`.

## What it checks (catalog → DESIGN.md §5)
MR-0 drill-down conservation · MR-8 desktop↔mobile parity (headlines) ·
MR-9 pill-split parity (desktop↔mobile cluster-split asymmetry — the reported bug) ·
MR-1 zoom non-vanishing · MR-2 stated-vs-rendered · MR-2b render-completeness (low-total "says 7, shows 3") ·
MR-3 per-family · MR-4 filter consistency + since-monotonicity ·
MR-5 lede-vs-scope-total (conditional) · MR-6 clean console · MR-7 idempotence/intermittency.

## Carve-outs (do NOT flag these)
- Lede is scope-total, not viewport — MR-5 only fires vs the scope total.
- Zoom-6 mode switch (aggregated↔observations) + row-cap `truncated` → drill-down uses tolerance, annotated.
- Mobile `grid-overflow` "+N" legitimately hides families → MR-2/MR-3 relax to `rendered ≤ stated`.
- OpenFreeMap tile-CDN failure → `inconclusive`, never a finding.
- `freshestObservationAt` differs between two reads → freshness skew, not a bug.

## Pacing (load-bearing)
Cloudflare = 60 req/min/IP. The guard refuses runs whose projected rate exceeds
~55/min; raise `--pace-ms` or lower `--samples`. Never bypass it (bursting /api
breaks bird-maps.com in the same session).

## The `#map=` viewbox link is the repro primitive (epic #1238 — always include it)
Every finding carries a `#map=` viewbox link that bakes in the camera, viewport,
scope, and active filters — open it and you land on the exact broken view. It is
a recently-shipped feature, so it is easy to forget it exists. **Rule: every
finding in the brief, and every ticket written from a finding, MUST include its
`#map=` viewbox link** as the canonical one-click reproduction. The same applies
to any hand-written bird-maps map/data bug ticket — lead with the viewbox link.

## Triage → confirm → file (the flow)
1. Agent runs the harness, curates `brief.md` + `findings/F*/` bundles, STOPS.
2. Julian reviews the brief (each finding shows its `#map=` viewbox link).
3. Orchestrator opens each confirmed finding's `#map=` viewbox link in chrome-devtools
   MCP, captures the canonical screenshot.
4. Julian files the ticket — **with the `#map=` viewbox link as the repro**. The agent never files.
