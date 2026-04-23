---
name: pr-workflow
description: Use when creating a PR, dispatching a review, or merging on `julianken/bird-sight-system`. Triggers on "create PR", "open PR", "merge PR", "queue PR", "review PR", "@Mergifyio queue", "dispatch the bot", "julianken-bot". Encodes the four load-bearing rules that CLAUDE.md previously held as prose; progressive-disclosure-friendly for subagents dispatched with `isolation: "worktree"` that do not load CLAUDE.md.
---

# PR workflow (julianken/bird-sight-system)

Direct push to `main` is blocked by branch protection (`enforce_admins=true`). Every change lands via a PR that passes four required checks (`test`, `lint`, `build`, `e2e`), gets an approving review from `@julianken-bot`, and is merged by Mergify. Do not use `gh pr merge`.

## The four load-bearing rules

1. **PR description follows `.github/PULL_REQUEST_TEMPLATE.md` verbatim.** All five sections (Diagrams, Summary, Screenshots, Test plan, Plan reference) are mandatory. Skipping sections costs review cycles. See `references/pr-template.md`.
2. **Bot review dispatches through the `julianken-bot` Agent subagent.** It loads credentials from macOS Keychain and posts as the `@julianken-bot` collaborator. Never use `gh pr review` from the main session — that posts under Julian's identity and invalidates the cross-model review. See `references/julianken-bot-dispatch.md`.
3. **Mergify queue comment body must be exactly `@Mergifyio queue`.** No prose before or after. Validated across 17+ cycles on the ear-training-station workflow. See `references/mergify-gotchas.md`.
4. **`.mergify.yml` config is pinned to three invariants** — `merge_queue.max_parallel_checks: 1`, `queue_rules[].batch_size: 1`, and no separate `merge_conditions` block. These are required for in-place checks to work alongside branch protection's `required_status_checks.strict: true`. See `references/mergify-config-contract.md`.

## End-to-end flow

```
feature branch  →  gh pr create (template)  →  julianken-bot subagent review
                                                     │
                                                 APPROVED?
                                                     │
                                          post `@Mergifyio queue`
                                                     │
                                          Mergify waits on 4 checks
                                                     │
                                       squash-merge + branch delete
```

1. Make changes on a feature branch. Conventional-commit prefix (`feat(scope):`, `chore:`, `docs:`, `fix:`, `plan(N):` etc.).
2. Open PR with `gh pr create --body "$(cat <<'EOF' … EOF)"` — paste the template body verbatim and fill every section. `Plan reference` links `docs/plans/<plan>.md` or states `Out of plan — <reason>`. `Screenshots` is REQUIRED when the diff touches `frontend/**` (otherwise `N/A — not UI`).
3. Dispatch `julianken-bot` Agent subagent to review. Do NOT call `gh pr review` yourself.
4. When `gh pr view <N> --json reviewDecision` returns `APPROVED`, post a new comment whose body is the literal string `@Mergifyio queue` — nothing else. If context is needed, post it as a separate preceding comment.
5. Mergify enters the queue, waits for all four checks to go green, squash-merges, and deletes the branch.

## Tripwires

- **Never `gh pr merge`.** It bypasses Mergify's queue and can land a PR with a stale base. Branch protection's `strict: true` + Mergify's `batch_size: 1` are the only combination that keeps this safe.
- **Never put prose around `@Mergifyio queue`.** Mergify's parser does literal-string matching; "Looks good, @Mergifyio queue" is silently ignored.
- **Never `gh pr review` from the main session.** The review must come from `@julianken-bot` (a separate `push` collaborator) to satisfy branch protection's 1-review requirement AND to avoid cross-model review bias.
- **Never edit `.mergify.yml` to add a `merge_conditions` block, raise `max_parallel_checks`, or raise `batch_size`** unless you also flip branch protection's `required_status_checks.strict` off. Mergify will error out on queue otherwise.

## Commits (stays in CLAUDE.md)

Conventional commits with scope where useful. Multi-line messages explain *why*, not *what* — the diff shows what. Commits section is small enough to stay inline; it is not hoisted here.

## See also

- `references/pr-template.md` — the five template sections and why each is load-bearing
- `references/julianken-bot-dispatch.md` — bot subagent credentials, dispatch pattern, NYU same-model-bias research
- `references/mergify-gotchas.md` — the `@Mergifyio queue` literal-string rule + 17-cycle validation history
- `references/mergify-config-contract.md` — the three `.mergify.yml` invariants and the branch-protection interaction that makes them load-bearing
