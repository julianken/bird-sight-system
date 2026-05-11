---
name: writing-plans
description: Project-level extension of the superpowers:writing-plans skill for julianken/bird-sight-system. Adds mandatory CSS sub-task gate for frontend component plans (closes #445). Triggers on all the same conditions as superpowers:writing-plans — "write a plan", "create an implementation plan", any planning work in this repo.
---

# Writing Plans (bird-sight-system extension)

This skill extends `superpowers:writing-plans` with project-specific gates.
Load and apply all rules from `superpowers:writing-plans` first, then apply the
additional rules below.

## Frontend component plans — mandatory CSS sub-task (closes #445)

When the plan touches any file under `frontend/src/components/**`, every task
that introduces or modifies a component MUST include an explicit sub-task for
surface-level CSS. This is non-optional — omitting it produced the class of
miss captured in #445 (Phase 3–5 plans said "build FooBar.tsx" without
saying "write CSS for `.foo-bar`").

**Required sub-task template (insert after the TSX implementation step):**

```markdown
- [ ] **Step N: Write CSS rules for [ComponentName]**

  In `frontend/src/styles.css` and/or `frontend/src/components/ds/ds-primitives.css`,
  add rules for every className introduced in this component. Exhaustive class list:
  `.class-a`, `.class-b`, `.class-c`  ← fill from the TSX you just wrote.

  Verify each class has at least one rule:

  grep -cE '^\.(class-a|class-b|class-c)' \
    frontend/src/styles.css \
    frontend/src/components/ds/ds-primitives.css

  Expected: non-zero count for every class. If any returns 0, add the missing
  rule before committing.
```

**Self-review gate (applies to plan author, not plan executor):** After
writing the plan, run the following search on the draft plan text itself:

```bash
grep -n "className" <plan-file>.md | grep -v "grep\|CSS rules\|Step N:"
```

If the grep returns any lines without a corresponding CSS sub-task in the same
task block, the plan is incomplete — add the missing CSS step(s) before saving.

## Quantified plan literals

Every plan that contains numeric or universal quantifiers in its task acceptance criteria MUST include a `## Quantified plan literals (implementer checklist)` section. This section appears **before the first task block** (after the file structure table if one exists, before Task 1).

**What qualifies as a manifest entry:**

- **Numeric quantifiers**: any count or measurement that appears in a task's acceptance criteria or success steps. Examples: "ship 14 dark-mode token overrides", "render 9 region polygons", "support 4 freshness states", "migrate 35 font-size literals", "344 rows of representative data".
- **Universal quantifiers**: "all", "every", "each", "no" applied to a set named in the plan's task ACs. Examples: "all surface tabs", "every viewport size", "each phase plan", "zero console errors".

If a plan contains no numeric or universal quantifiers in its task ACs, the section is omitted and a brief note (`_No quantified literals in this plan._`) is added in its place so reviewers know the author checked.

**Ownership — explicit:**

- **Plan author** writes the manifest section before authoring any task block. The author is responsible for keeping it current if the plan is amended. Omitting a qualifying literal is an author-side gap that silences the reviewer-side gate (see Composition with R13 T7 below).
- **Implementer** must check off each manifest item before opening the impl PR, or cite a deferral document with a lexically-matching subject (per R13 T7, issue #461). "Lexically matching" means the deferral document's subject line contains the same noun phrase as the manifest item (e.g., manifest says "14 dark-mode tokens"; a valid deferral says "Defer 14 dark-mode token overrides to Phase 2 — [reason]"; an invalid deferral says "Defer basemap loading" — subject mismatch, T7 fires).
- **Reviewer** (bot or human): verifies that each manifest item is either checked or has a valid lexically-matching deferral citation. An unchecked item with no deferral is a T7 finding (SUGGESTION tier).

**Composition with R13 T7 (issue #461) — manifest coverage is a T7 precondition:**

R13 T7 is a *reviewer* gate that fires when the bot reviews an impl PR: it checks whether each quantified literal in the plan's manifest appears as either a checked box or a cited deferral. If the plan author omits a quantified literal from the manifest, T7 has no corpus to lexically match against and silently skips — the gap passes undetected. The author-side manifest is therefore a **necessary precondition** for the reviewer-side gate to fire. Both gates must be in place to close the gap at both ends.

**Worked example (the T7 lexical-match failure case):**

Plan manifest entry:
```
- [ ] Ship 14 dark-mode token overrides in `[data-theme="dark"]` block
```

Implementer opens PR without checking this box, instead adding a deferral doc titled: _"Defer basemap loading to Phase 2"_.

T7 fires: the deferral subject ("basemap loading") does not lexically match the manifest item ("14 dark-mode token overrides"). The reviewer catches the gap. Correct fix: either check the box (ship the tokens) or write a deferral doc whose subject reads _"Defer 14 dark-mode token overrides to Phase 2 — [reason]"_.

**Manifest format:**

```markdown
## Quantified plan literals (implementer checklist)

Before opening a PR for this plan, check off each item or cite a deferral doc
with a lexically-matching subject (per R13 T7, issue #461):

- [ ] Ship 14 dark-mode token overrides in `[data-theme="dark"]` block
- [ ] Render 9 region polygons on map load
- [ ] Expose `MAX(inserted_at)` as `meta.freshestObservationAt` in API envelope
- [ ] All surface tabs respond to keyboard navigation
- [ ] Every viewport: zero console errors
```

**Retroactive backfill scope for Sky Atlas plans:**

- Sky Atlas has 7 phase plans (Phases 0–6). Do not assume 9.
- **High-value backfill: Phase 1 only** (the documented walkback case — makes the worked example concrete with real literals from the token-foundation plan).
- Phases 0, 2–6: optional follow-up; must not block Phase 1 backfill or any impl PR.
- Merged plans beyond Phase 1: do not backfill (the manifest cannot retroactively gate closed PRs).

## Multi-viewport design-review gate

For any plan that adds or modifies visible UI under `frontend/**`, the plan
MUST include a task that dispatches a design-review subagent at all 5 canonical
viewports. Reference this issue's process: #445.

**Canonical viewport set** (non-negotiable for design-related PRs):

| # | Viewport | Device class |
|---|---|---|
| 1 | 390×844 | iPhone 14 Pro (mobile) |
| 2 | 768×1024 | iPad portrait (tablet) |
| 3 | 1024×768 | iPad landscape / small laptop |
| 4 | 1440×900 | Desktop standard |
| 5 | 1920×1080 | Wide desktop |

Capture at both light and dark theme (10 screenshots minimum per touched
surface). Dark-mode trigger: `document.documentElement.setAttribute('data-theme', 'dark')`
via Playwright MCP `browser_evaluate` — NOT `prefers-color-scheme` emulation
(the repo overrides via attribute, not media query).
