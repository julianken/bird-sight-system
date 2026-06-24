# map-consistency

A metamorphic-testing harness that samples bird-maps.com at a configurable count,
walks a zoom ladder on desktop + mobile, and emits a preserved findings brief that
separates real map/data consistency bugs (counts that don't conserve across a
drill-down, desktop pills that don't split like mobile's, a lede that disagrees
with the viewport total, a dirty console) from the app's documented-legitimate
divergences. It is a pure metamorphic-relation engine (`relations.ts`) driven by a
Playwright capture layer; it never mutates prod and stops at a brief for triage.

## Run it

```sh
npm run audit:map-consistency -w @bird-watch/frontend -- --samples N --scope US
```

Useful flags: `--scope US|US-XX`, `--seed K`, `--zoom-ladder 3,5,7,10,13`,
`--viewports desktop,mobile`, `--pace-ms` (default 2500 — Cloudflare is 60 req/min/IP,
so the pacing guard refuses runs that would exceed ~55/min), `--base-url` (default
`https://bird-maps.com`). Probe a single view: `... -- --probe '<#map= url>'`.

## Design

Full architecture, the metamorphic-relation catalog (MR-0…MR-9), the carve-outs
that suppress false positives, and the pacing math live in
[`.claude/skills/map-consistency-audit/DESIGN.md`](../../../.claude/skills/map-consistency-audit/DESIGN.md).
