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
