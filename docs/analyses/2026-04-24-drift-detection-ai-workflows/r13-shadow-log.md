# R13 Shadow-Mode Firing Log

R13 is the drift-introduction check in the `julianken-bot` PR-review rubric.
It fires when a PR diff touches drift-prone surfaces (route changes, shared types,
migrations, spec/plan docs, CLAUDE.md, workflows) and checks for drift between
the stated scope and the actual diff.

**Shadow mode active** — R13 findings are emitted as collapsed `<details>` blocks
in bot review comments and do NOT contribute to the bot's verdict severity.
This log tracks firings toward the 30-firing promotion gate.

**Promotion criteria** (all three must be met):
- 30 rows logged in this table
- FP rate ≤ 15% (≤ 5 of 30 rows marked Y in the FP? column)
- No PR in the window caused a same-day hotfix traceable to drift that R13 missed

**To promote**: open a PR that removes the `SHADOW MODE` marker from R13 in
`~/.claude/skills/reviewing-as-julianken-bot/SKILL.md`. Maintainer sign-off
required on that PR.

---

## Firing log

| PR | Date | R13 fired? | Tier | Finding summary | FP? (Y/N) |
|----|------|------------|------|-----------------|-----------|
