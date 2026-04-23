# `.mergify.yml` config contract

This repo's `.mergify.yml` is pinned to three invariants. Each is load-bearing because of how Mergify's queue interacts with GitHub branch protection's `required_status_checks.strict: true` (the "require branches be up to date before merging" toggle). Changing any one without flipping branch protection too will break the queue.

## The three invariants

1. **`merge_queue.max_parallel_checks: 1`**
2. **`queue_rules[].batch_size: 1`**
3. **No separate `merge_conditions:` block.** All conditions live under `queue_conditions:`.

## Why each is load-bearing

### `max_parallel_checks: 1`

Branch protection with `strict: true` means: before a PR merges, its branch must be up-to-date with `main`. If Mergify tries to run checks on two queued PRs in parallel, one of them is guaranteed to be stale by the time it tries to merge (because the other just landed and advanced `main`). Mergify will then error out or re-queue, which wastes CI minutes and produces confusing queue state.

Setting `max_parallel_checks: 1` makes the queue strictly serial: Mergify rebases PR #2 onto the new `main` only *after* PR #1 has landed. No race.

### `batch_size: 1`

A batch of two PRs tested together can pass CI as a pair but fail individually once split — e.g. PR A provides a type that PR B consumes. With `batch_size: 1`, each PR runs its four required checks (`test`, `lint`, `build`, `e2e`) in isolation against the current `main`, which is exactly the guarantee branch protection's required-checks contract is trying to enforce.

With `batch_size > 1` and `strict: true`, the required checks on the individual PRs are NOT re-run after the batch splits — so a PR can land whose individual commit never had green CI. That is the exact hole branch protection is meant to close.

### No separate `merge_conditions:` block

In recent Mergify versions, `merge_conditions:` and `queue_conditions:` are distinct blocks that can diverge. If `merge_conditions` omits (or weakens) a condition that `queue_conditions` enforces, a PR can enter the queue, pass queue-time checks, and then merge under laxer conditions. We keep *all* conditions under `queue_conditions:` — a single source of truth — so the queue-entry gate and the merge gate are literally the same list.

This also sidesteps a Mergify config-validation bug where `merge_conditions` defined alongside `batch_size: 1` + `strict: true` branch protection has produced spurious "config invalid" errors on the queue. The recommended shape in this topology is queue-conditions-only.

## When the invariants could relax

If branch protection's `required_status_checks.strict` is ever flipped to `false` (i.e. PRs can merge without being up-to-date with `main`), the race that `max_parallel_checks: 1` + `batch_size: 1` prevents no longer exists. At that point both values could be raised to speed up the queue. Until then, leave them.

## Tripwire summary

- Before editing `.mergify.yml`, run `gh api repos/julianken/bird-sight-system/branches/main/protection` and confirm `required_status_checks.strict: true`.
- If `strict: true` is still set, do NOT raise `max_parallel_checks`, do NOT raise `batch_size`, and do NOT introduce a `merge_conditions:` block.
- If `strict: false` (future state), the invariants can be relaxed — but update `.mergify.yml`, this reference, and the comment in `.mergify.yml` in the same PR.
