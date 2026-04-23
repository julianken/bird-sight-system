# Mergify queue comment — the literal-string rule

## The rule

After `@julianken-bot` posts `reviewDecision: APPROVED`, the way to enter the merge queue is to post a comment on the PR whose **body is exactly**:

```
@Mergifyio queue
```

Nothing before it. Nothing after it. No Markdown wrapping. No bullet. No leading emoji. No trailing newline-of-prose.

## Why this is load-bearing

Mergify's command parser matches the **entire comment body** against a literal string. It does not fuzzy-match, does not parse out surrounding prose, and does not look at the first line only. The result: a comment like

> Looks good, @Mergifyio queue — thanks for the fast turnaround!

is **silently skipped**. No error. No Mergify reaction. The PR sits in "approved but not queued" limbo until someone notices and posts a clean comment.

## Validation history

This failure mode was the cause of a long tail of stuck PRs in the **ear-training-station** workflow. Across **17+ review cycles** we watched the same pattern: reviewer approves, implementer posts a combined comment acknowledging the approval *and* trying to queue, PR sits unqueued for hours. Splitting the acknowledgement and the queue trigger into two separate comments eliminated the problem entirely.

The 17-cycle number is not an anecdote — it is the count of approve-then-miss-queue incidents measured before the team converged on a hard rule. Every subsequent repo (including `bird-sight-system`) inherits the rule by default.

## The split-comment pattern

When you have context to leave (e.g. "addressed the SUGGESTION in commit abc123", "here's why I kept the second approach"), post it as its **own** comment first. Then post `@Mergifyio queue` as a standalone second comment. Two `gh pr comment` calls, not one.

```
gh pr comment <N> --body "Addressed the SUGGESTION in commit abc123 — squashed the helper into the caller."
gh pr comment <N> --body "@Mergifyio queue"
```

## What good looks like

The queue comment on a merged PR, viewed via `gh pr view <N> --comments`, should show a comment body of exactly 16 characters: `@Mergifyio queue`. Anything longer is a latent footgun.

## Tripwire summary

- Never wrap the trigger in a sentence.
- Never combine the trigger with context or acknowledgement.
- Always post it as its own comment, its own body, exactly as shown.
- If in doubt, `gh pr view <N> --comments | tail` to confirm the trigger comment body is exactly `@Mergifyio queue`.
