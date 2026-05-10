# G1 — PostHog audience-profile audit

**Status:** Deferred. Gates Phase 6 (metadata + brand voice) only. Phases 0–5 ship without it.

## Why deferred

The gate matters only for voice register. Phase 0 (`pushState` + `DEFAULTS.view='map'` + `motion.css` + MapLibre guard), Phase 1 (tokens), Phase 2 (primitives), Phases 3–5 (surfaces) are all voice/metadata-orthogonal. Voice register decisions land in Phase 6 — that's where G1 must close.

## What to read in PostHog (~15 min)

The site has PostHog running in production (confirmed at `frontend/src/components/AttributionModal.tsx:536` + `frontend/src/analytics.ts`). Read 7 metrics; pattern-match against engaged-birder vs casual-visitor signature.

| Metric | Where in PostHog | Engaged-birder signature | Casual-visitor signature |
|---|---|---|---|
| Bounce rate (first visit, < 30 s) | Trends → `$pageview`, filter `session.duration < 30s` | <30% | >50% |
| Mobile vs desktop split | Trends → `$pageview` grouped by `$device_type` | mobile-heavy 60%+ | balanced or desktop-heavy |
| Return rate (30 d) | Retention → unique users w/ ≥3 sessions | ≥40% | <15% |
| Median session duration | Trends → median `session.duration` | >3 min | <90 s |
| Filter usage | `$pageview` events with `?notable=` / `?since=` / `?family=` / `?species=` in URL | >25% | <10% |
| Detail-view depth | `species_detail_scroll_to_bottom` event (if instrumented) | >40% | <15% |
| Repeat detail opens / session | Session-recording sample of 5 sessions | ≥2 | 0–1 |

## Decision rubric

- **≥4 metrics in engaged column** → Position A++ refinement (fill metadata with neutral factual claims; in-app voice unchanged). Spec [`../../01-spec/voice-and-content.md`](../../01-spec/voice-and-content.md) and [`../../00-overview/decisions.md`](../../00-overview/decisions.md) get amended.
- **≥4 metrics in casual column** → spec proceeds as written; Phase 6 ships Position B voice.
- **Split (3-3 or unclear)** → Phase 6 ships Position B; reconsider only if onboarding analytics post-ship show casual confusion.

## What changes if engaged-birder signature returns

| Spec section | Change |
|---|---|
| [`../../00-overview/decisions.md`](../../00-overview/decisions.md) row #3 | Voice position changes from "Position B" to "Position A++ refinement" |
| [`../../01-spec/voice-and-content.md`](../../01-spec/voice-and-content.md) Position B section | Reframed as "neutral factual claims for metadata; in-app copy unchanged" |
| Lede contract | Stays the same (the 4 templates work for either voice register; the templates are factual claims either way) |
| Freshness label | Stays the same |
| Accent discipline | Unchanged |
| Phase 6 plan | Voice rewrites scope reduces — only `App.tsx:147` raw error fix is required; other 14 strings preserve |
| Visual direction | Unchanged. Sky Atlas visual identity holds either way. |

## Implementation steps once data is available

1. Open PostHog dashboard
2. Capture the 7 metrics above
3. Apply decision rubric (count engaged vs casual columns)
4. Update [`../../01-spec/open-questions.md`](../../01-spec/open-questions.md) G1 row to "Closed YYYY-MM-DD: <signature>"
5. Update [`../../00-overview/decisions.md`](../../00-overview/decisions.md) row #3 if signature is engaged-birder
6. If signature changes voice register, also update [`../../02-phases/phase-6-metadata-voice.md`](../../02-phases/phase-6-metadata-voice.md) acceptance criteria

## When to run

Anytime before Phase 6 starts. Phases 0–5 do not depend on this. Recommended: run during Phase 4 or 5 implementation so the result is fresh for Phase 6 planning.

## Why this isn't blocking earlier phases

Position B vs Position A++ differ only in whether the in-app copy register is rewritten. Both close the 19 metadata gaps; both keep the visual direction; both keep the lede + freshness contract. The difference is whether the existing 14 visible strings are touched.

Phases 0–5 don't change any of those strings (their scope is engineering, tokens, primitives, surface chrome — not copy). Voice work is genuinely Phase 6 territory.

## Cross-references

- Spec: [`../../01-spec/open-questions.md`](../../01-spec/open-questions.md), [`../../01-spec/voice-and-content.md`](../../01-spec/voice-and-content.md)
- Decisions: [`../../00-overview/decisions.md`](../../00-overview/decisions.md)
- Phase 6 plan: [`../../02-phases/phase-6-metadata-voice.md`](../../02-phases/phase-6-metadata-voice.md)
