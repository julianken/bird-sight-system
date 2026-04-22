# Analysis Funnel Status

## Current State
- **Phase:** Final (complete)
- **Last updated:** 2026-04-21
- **Artifact root:** /Users/j/repos/bird-watch/docs/analyses/2026-04-20-frontend-map-analysis

## Analysis Question
Why is the map-based bird-watch frontend failing, and what evidence should inform a map-less reimagining?

## Analysis Conclusion
The map rendering chain was the root cause: SVG-based region expansion was
too complex, viewport-sensitive, and unmaintainable to sustain past Release 1.
The evidence (prototype timing data, console error audit, rendering-chain
complexity) justified a complete DISCARD-and-reimagine. Path A (three surface
views: Feed / Species / Hotspots with URL-driven navigation) was selected and
implemented as Plan 6. See `docs/plans/2026-04-21-plan-6-path-a-reimagine.md`.

## Phase Completion
- [x] Phase 0: Frame
- [x] Phase 1: Investigate (5 areas)
- [x] Phase 2: Iterate (5 iterators)
- [x] Phase 3: Synthesize (3 synthesizers)
- [x] Phase 4: Final report

## Outcome
Plan 6 shipped. PR #125 tracker closed. Path A is live at bird-maps.com.
Context packets and phase artifacts are in this directory.
