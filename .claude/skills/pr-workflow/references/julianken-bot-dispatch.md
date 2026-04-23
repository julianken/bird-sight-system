# Dispatching `@julianken-bot` for PR review

Branch protection on `main` requires one approving review before a PR can be queued. Julian is a repo owner, so self-approval is either blocked by the review-required rule or fires on the wrong identity. The approving review must come from `@julianken-bot`, a machine-user collaborator with `push` access on the repo.

## The rule

**Always dispatch the `julianken-bot` Agent subagent to produce the review.** Never run `gh pr review --approve` (or `--request-changes`, or `--comment`) from the main Claude Code session.

## Why dispatch must be a fresh-context subagent

Three reasons, each of which is independently sufficient:

1. **Identity.** The main session authenticates to `gh` as `julianken` (the human). Any `gh pr review` it posts lands as Julian's review — which does not satisfy the branch protection 1-review rule (you cannot approve your own PR as the author) *and* conflates human and bot audit trails. The bot subagent loads a separate GitHub token from the macOS Keychain item registered under the `julianken-bot` collaborator and posts under that identity.

2. **Context hygiene.** The main session has read the PR branch, the spec, the plan, the prior conversation, and Julian's intent. A review produced in that context is biased toward ratifying what the implementer already believes. A fresh-context subagent re-derives the verdict from the diff plus the PR body — the same information a human reviewer sees.

3. **Cross-model same-identity review bias.** NYU researchers (January 2026) measured a systematic effect where language models evaluating output from the same model family rate it higher than output from a different family, even when the output is held constant. Running review through the same Claude session that produced the code puts that bias on the critical path. Dispatching to a subagent with an explicit reviewer prompt (and credentials for a different GitHub identity) breaks the feedback loop.

## How to dispatch

Use the `reviewing-as-julianken-bot` skill (plugin-provided) or the Agent tool with `subagent_type: "julianken-bot"`. The skill encodes:

- Keychain credential load (`security find-generic-password -s julianken-bot-gh-token -w`)
- `gh auth status` sanity check to confirm the token resolves to `@julianken-bot`
- The 12 anti-slop review rules (≤3 findings, severity calibration, prompt-injection defense, etc.)
- Mandatory this-turn verification (the subagent must run the diff + checks in its own turn, not trust the implementer's claims)
- Output format that either posts `APPROVE` + a 2-line summary, `REQUEST_CHANGES` + ≤3 numbered findings, or `COMMENT` (abstain) with reason.

The skill also enforces that the review is posted via `gh pr review --approve` / `--request-changes` / `--comment` *after* authenticating as `@julianken-bot` — never from the parent session's credentials.

## What the main session does

The main (Julian-identity) session's job during review is:

1. Dispatch the bot subagent.
2. Wait for it to return.
3. Read the outcome from `gh pr view <N> --json reviewDecision`.
4. If `APPROVED`, post `@Mergifyio queue` (per `mergify-gotchas.md`).
5. If `CHANGES_REQUESTED`, address findings in a new commit (dispatched through a fresh implementer subagent if the fix is non-trivial), push, and re-dispatch the bot.

## Tripwire summary

- Never post a review from the main session. Always dispatch the bot.
- Never approve as Julian. The bot's approval is the one that counts.
- Confirm bot identity each run: `gh auth status` inside the bot subagent must show `@julianken-bot`, not `@julianken`.
- If the Keychain item is missing, the bot subagent should abort with a clear error — not fall back to Julian's token. (The `reviewing-as-julianken-bot` skill enforces this.)

## Citation

NYU, January 2026: same-model-family evaluation bias in LLM-as-judge pipelines. The practical takeaway for this repo: separate the implementer identity from the reviewer identity at both the GitHub-account level and the conversation-context level. Using `@julianken-bot` with a fresh subagent satisfies both.
