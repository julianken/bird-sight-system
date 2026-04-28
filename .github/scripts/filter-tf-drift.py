#!/usr/bin/env python3
"""Filter `terraform show -json` plan output against a checked-in allowlist.

Wired into `.github/workflows/terraform-plan-drift-check.yml`. Reads plan JSON
from stdin (pipe from `terraform show -json <plan.bin>`), reads the allowlist
from `.github/drift-allowlist.yml`, and decides whether nightly drift is
all-suppressed, novel, or sitting on an expired suppression.

Exit codes (the workflow branches on these):
  0  all planned changes are covered by unexpired allowlist entries
     (no issue opened)
  1  novel drift is present — changes not covered by any allowlist entry.
     A GitHub-Flavored-Markdown issue body is written to stdout; the workflow
     pipes it into `gh issue create`.
  2  expired allowlist entries still have drift active. A meta-alert issue
     body is written to stdout; the workflow flags this as "grace window
     lapsed — either import the resource or renew the suppression".

Also emits GitHub Actions warning annotations when any allowlist entry
expires in <=7 days (stdout, prefixed `::warning::`). The workflow surfaces
these in the job summary.

Design notes:
- Security: the `terraform show -json` output contains provider-supplied
  secrets (DB passwords, API keys) under `variables[].value` and resource
  `values[]`. This script MUST NOT echo any field from those subtrees. The
  issue body only emits resource address + action tuples. Run locally to
  confirm before trusting in CI.
- Determinism: allowlist entries are keyed on (address, action). A plan
  change with a compound action list ["delete","create"] counts as two
  discrete matches (one per action); both must be allowlisted.
- Fail-loud: an unparseable allowlist or JSON is exit code 3 with a
  readable error on stderr — never exit 0 silently.

Standard library only plus PyYAML (available on ubuntu-latest's stock
Python). No pip install needed.
"""

from __future__ import annotations

import datetime as _dt
import json
import pathlib
import sys
from typing import Iterable

try:
    import yaml  # PyYAML
except ImportError:  # pragma: no cover — runner always has it
    print(
        "::error::PyYAML not available. Install via `pip install pyyaml` or "
        "ensure the runner has it pre-installed.",
        file=sys.stderr,
    )
    sys.exit(3)


REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
ALLOWLIST_PATH = REPO_ROOT / ".github" / "drift-allowlist.yml"
EXPIRY_WARNING_DAYS = 7

# `terraform show -json` emits these action tokens in change.actions[]. Only
# these cause drift from a CI-watcher perspective; no-op is ignored.
DRIFT_ACTIONS = {"create", "update", "delete", "read"}


def load_allowlist(path: pathlib.Path) -> list[dict]:
    """Return the list under `allowlist:` in drift-allowlist.yml.

    Each entry is validated for the four required keys. Missing keys are a
    hard failure — we will not silently drop entries.
    """
    if not path.exists():
        print(f"::error::allowlist file not found: {path}", file=sys.stderr)
        sys.exit(3)

    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        print(f"::error::allowlist YAML parse failed: {exc}", file=sys.stderr)
        sys.exit(3)

    entries = (raw or {}).get("allowlist") or []
    required = {"address", "action", "expires", "reason"}
    for i, entry in enumerate(entries):
        missing = required - entry.keys()
        if missing:
            print(
                f"::error::allowlist entry {i} missing keys: "
                f"{sorted(missing)}",
                file=sys.stderr,
            )
            sys.exit(3)
        # normalise
        if isinstance(entry["expires"], _dt.date):
            entry["expires_date"] = entry["expires"]
        else:
            try:
                entry["expires_date"] = _dt.date.fromisoformat(
                    str(entry["expires"])
                )
            except ValueError as exc:
                print(
                    f"::error::allowlist entry {i} ({entry['address']}) "
                    f"`expires` is not ISO-8601 YYYY-MM-DD: {exc}",
                    file=sys.stderr,
                )
                sys.exit(3)
    return entries


def extract_drift(plan: dict) -> list[tuple[str, str]]:
    """Return (address, action) pairs for every non-no-op resource change.

    Security note: we read only address + actions from each entry, never
    `values` or `before`/`after` content, because those can contain live
    secrets that terraform-show-json surfaces in full.
    """
    drift: list[tuple[str, str]] = []
    for rc in plan.get("resource_changes", []):
        actions = rc.get("change", {}).get("actions") or []
        for action in actions:
            if action in DRIFT_ACTIONS:
                drift.append((rc["address"], action))
    return drift


def match_key(entry: dict) -> tuple[str, str]:
    return (entry["address"], entry["action"])


def classify(
    drift: list[tuple[str, str]],
    allowlist: list[dict],
    today: _dt.date,
) -> tuple[list[tuple[str, str]], list[dict], list[dict]]:
    """Split drift and allowlist into three bins.

    Returns:
        novel:   drift tuples NOT covered by any allowlist entry (any state)
        expired: allowlist entries whose drift IS still active AND expires<today
        warning: allowlist entries expiring within EXPIRY_WARNING_DAYS days
    """
    allow_active: dict[tuple[str, str], dict] = {}
    allow_expired: dict[tuple[str, str], dict] = {}
    warning: list[dict] = []

    for entry in allowlist:
        key = match_key(entry)
        if entry["expires_date"] < today:
            allow_expired[key] = entry
        else:
            allow_active[key] = entry
            days_left = (entry["expires_date"] - today).days
            if 0 <= days_left <= EXPIRY_WARNING_DAYS:
                warning.append(entry)

    novel: list[tuple[str, str]] = []
    expired_hit: list[dict] = []
    for d in drift:
        if d in allow_active:
            continue
        if d in allow_expired:
            expired_hit.append(allow_expired[d])
            continue
        novel.append(d)

    return novel, expired_hit, warning


def emit_warning_annotations(warnings: Iterable[dict], today: _dt.date) -> None:
    for entry in warnings:
        days_left = (entry["expires_date"] - today).days
        print(
            f"::warning title=drift allowlist expiring::"
            f"{entry['address']} ({entry['action']}) expires in "
            f"{days_left} day(s) on {entry['expires']}. Reconcile before "
            f"then or the next drift-check run will open an issue.",
            file=sys.stderr,
        )


def novel_issue_body(
    novel: list[tuple[str, str]],
    run_url: str | None,
) -> str:
    lines = [
        "Nightly `terraform plan` surfaced drift that is **not** covered by "
        "`.github/drift-allowlist.yml`.",
        "",
        "## Novel drift",
        "",
        "| Resource address | Planned action |",
        "| --- | --- |",
    ]
    for address, action in sorted(novel):
        lines.append(f"| `{address}` | `{action}` |")
    lines += [
        "",
        "## Next steps",
        "",
        "1. Decide: is this intentional drift (someone applied out-of-band) "
        "or unintentional (`terraform apply` would recover it)?",
        "2. If intentional, add a dated entry to `.github/drift-allowlist.yml` "
        "with a reconciliation-issue reference and an `expires:` date.",
        "3. If unintentional, open a follow-up issue to run `terraform "
        "import` or `terraform apply` on the affected resource(s).",
        "",
        "Security note: full `terraform show -json` output is **intentionally "
        "not pasted** here — it contains live DB/provider credentials under "
        "`variables[].value`. Run `terraform plan` locally (or re-run the "
        "nightly workflow and read the action logs under the `terraform plan` "
        "step's stderr, which is also credential-redacted) to inspect "
        "`before`/`after` values.",
    ]
    if run_url:
        lines += ["", f"Source: {run_url}"]
    return "\n".join(lines)


def expired_issue_body(
    expired: list[dict],
    run_url: str | None,
) -> str:
    lines = [
        "Drift allowlist entries have **expired** with their drift still "
        "active. The 2-week grace window has lapsed; either reconcile the "
        "resource (terraform import/apply) or renew the suppression with a "
        "fresh `expires:` date and a rationale update.",
        "",
        "## Expired entries (still drifted)",
        "",
        "| Resource address | Action | Expired | Reason |",
        "| --- | --- | --- | --- |",
    ]
    for entry in sorted(expired, key=lambda e: (e["address"], e["action"])):
        lines.append(
            f"| `{entry['address']}` | `{entry['action']}` | "
            f"{entry['expires']} | {entry['reason']} |"
        )
    lines += [
        "",
        "Renew via edit to `.github/drift-allowlist.yml`; reconcile via "
        "`terraform import` + PR against `infra/terraform/**`.",
    ]
    if run_url:
        lines += ["", f"Source: {run_url}"]
    return "\n".join(lines)


def main() -> int:
    try:
        plan = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(
            f"::error::terraform plan JSON parse failed: {exc}",
            file=sys.stderr,
        )
        return 3

    today = _dt.date.today()
    allowlist = load_allowlist(ALLOWLIST_PATH)
    drift = extract_drift(plan)

    novel, expired_hit, warning = classify(drift, allowlist, today)
    emit_warning_annotations(warning, today)

    run_url = None
    import os

    server = os.environ.get("GITHUB_SERVER_URL")
    repo = os.environ.get("GITHUB_REPOSITORY")
    run_id = os.environ.get("GITHUB_RUN_ID")
    if server and repo and run_id:
        run_url = f"{server}/{repo}/actions/runs/{run_id}"

    if novel:
        print(novel_issue_body(novel, run_url))
        return 1
    if expired_hit:
        print(expired_issue_body(expired_hit, run_url))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
