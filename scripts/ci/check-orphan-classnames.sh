#!/usr/bin/env bash
# check-orphan-classnames.sh
#
# Verifies that every className referenced in JSX/TSX under
# frontend/src/components/ has a matching CSS selector in the project's
# CSS files. Fails with exit code 1 and a diagnostic message if orphans
# are found.
#
# Usage (local dev):
#   bash scripts/check-orphan-classnames.sh
#
# Usage (CI — called by .github/workflows/orphan-classname-check.yml):
#   bash scripts/check-orphan-classnames.sh
#
# Allow-list:
#   .github/orphan-classname-allowlist.yml lists classNames that are
#   intentionally excluded from the check. See that file for the
#   documented rationale for each entry.
#
# Static extraction strategy:
#   1. String-literal classNames ("foo bar") -> split on spaces, add each.
#   2. Ternary template classNames (`foo${x ? ' bar' : ''}`) -> extract
#      the static prefix and all branch literals.
#   3. Compound ternary (`foo${a ? ' b' : ''}${c ? ' d' : ''}`) -> each
#      ternary branch extracted independently.
#   4. Union-literal template classNames (`foo--${snap}`) -> add resolved
#      variants to the allow-list (.github/orphan-classname-allowlist.yml).
#
# Runtime: typically <5s on this codebase. Target is <30s per issue AC.
#
# Compatibility: requires bash >= 3.2 (macOS stock), grep, awk, sort, find.
# Uses temporary files instead of associative arrays for bash 3.2 compat.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
JSX_GLOB="${REPO_ROOT}/frontend/src/components"
ALLOWLIST_FILE="${REPO_ROOT}/.github/orphan-classname-allowlist.yml"

CSS_FILES=(
  "${REPO_ROOT}/frontend/src/styles.css"
  "${REPO_ROOT}/frontend/src/styles/tokens.css"
  "${REPO_ROOT}/frontend/src/styles/motion.css"
  "${REPO_ROOT}/frontend/src/components/ds/ds-primitives.css"
)

# Temporary files — cleaned up on exit
TMP_CSS_SELECTORS="$(mktemp /tmp/orphan-check-css.XXXXXX)"
TMP_ALLOWLIST="$(mktemp /tmp/orphan-check-allow.XXXXXX)"
TMP_ORPHANS="$(mktemp /tmp/orphan-check-orphans.XXXXXX)"
cleanup() { rm -f "$TMP_CSS_SELECTORS" "$TMP_ALLOWLIST" "$TMP_ORPHANS"; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Build CSS selector list (sorted, one per line)
# ---------------------------------------------------------------------------
for css_file in "${CSS_FILES[@]}"; do
  [[ -f "$css_file" ]] || continue
  # Extract .classname tokens; strip leading dot; write one per line.
  grep -oE '\.[a-zA-Z_][a-zA-Z0-9_-]*' "$css_file" 2>/dev/null \
    | sed 's/^\.//' >> "$TMP_CSS_SELECTORS" || true
done
sort -u "$TMP_CSS_SELECTORS" -o "$TMP_CSS_SELECTORS"

# ---------------------------------------------------------------------------
# 2. Load allow-list (simple "- classname" YAML entries)
# ---------------------------------------------------------------------------
if [[ -f "$ALLOWLIST_FILE" ]]; then
  grep -E '^[[:space:]]*-[[:space:]]+[a-zA-Z_][a-zA-Z0-9_-]*' "$ALLOWLIST_FILE" \
    | sed -E 's/^[[:space:]]*-[[:space:]]*//' \
    | sed 's/[[:space:]].*//' \
    >> "$TMP_ALLOWLIST" || true
fi
sort -u "$TMP_ALLOWLIST" -o "$TMP_ALLOWLIST"

# ---------------------------------------------------------------------------
# Helper: check if a className is in CSS or allow-list
# Returns 0 (found), 1 (orphan)
# ---------------------------------------------------------------------------
is_known() {
  local cls="$1"
  [[ -z "$cls" ]] && return 0
  # Check CSS selectors
  if grep -qxF "$cls" "$TMP_CSS_SELECTORS" 2>/dev/null; then
    return 0
  fi
  # Check allow-list
  if grep -qxF "$cls" "$TMP_ALLOWLIST" 2>/dev/null; then
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# 3. Extract JSX classNames and check against CSS
# ---------------------------------------------------------------------------

# Find all .tsx files (exclude test files to avoid asserting on class strings
# used in querySelector calls which are not JSX classNames)
while IFS= read -r tsx_file; do
  rel_file="${tsx_file#"${REPO_ROOT}/"}"
  line_num=0

  while IFS= read -r raw_line; do
    (( line_num++ )) || true

    # ── 3a. Static string literals: className="foo bar baz"
    # Use a subshell + sed loop to handle multiple classNames per line.
    tmp_line="$raw_line"
    while true; do
      # Extract first className="..." on the remaining line
      cls_val="$(printf '%s' "$tmp_line" | sed -n 's/.*className="\([^"]*\)".*/\1/p')"
      [[ -z "$cls_val" ]] && break
      # Remove this match to continue to the next on the same line
      tmp_line="${tmp_line/"className=\"${cls_val}\""/ }"
      for cls in $cls_val; do
        is_known "$cls" && continue
        printf '%s\t%s\t%d\n' "$cls" "$rel_file" "$line_num" >> "$TMP_ORPHANS"
      done
    done

    # ── 3b. Template literal ternary branches: className={`...${cond ? ' cls' : ''}...`}
    # Extract all static segments (between ${} expressions) and all single-quoted branch literals.
    if printf '%s' "$raw_line" | grep -qE 'className=\{`'; then
      # Static segments: extract entire template content between className={` ... `},
      # then replace every ${...} expression with a space so the remaining words
      # are the static class tokens.  This covers both the prefix and any segments
      # that appear after a ternary (e.g. `base ${a ? 'x' : ''} extra`).
      #
      # Bug fix — was: sed -n "s/.*className=\`\([^\$\`{]*\).*/\1/p"
      #   That pattern matched className=` (no brace) so it never matched the
      #   real JSX syntax className={\` and always returned empty.
      tmpl_inner="$(printf '%s' "$raw_line" \
        | grep -oE 'className=\{`[^`]+`' \
        | sed 's/className={`//' \
        | sed 's/`$//')"
      if [[ -n "$tmpl_inner" ]]; then
        static_parts="$(printf '%s' "$tmpl_inner" | sed 's/\${[^}]*}/ /g')"
        for cls in $static_parts; do
          [[ -z "$cls" ]] && continue
          is_known "$cls" && continue
          printf '%s\t%s\t%d\n' "$cls" "$rel_file" "$line_num" >> "$TMP_ORPHANS"
        done
      fi
      # Branch literals from ternary: ? 'class-name' : or ? ' class-name' :
      # Also catches the else branch:             : 'class-name' or : ' class-name'
      #
      # Bug fix — was: grep -oE "\? +' *[a-zA-Z_]...' *:"
      #   That pattern required any optional space to sit OUTSIDE the quote marks
      #   (before the opening quote), so `? ' is-active'` — where the space is
      #   INSIDE the single-quote — was never matched.
      #   The fix allows optional whitespace inside the quote via [[:space:]]* and
      #   strips it after extraction with sed.
      printf '%s\n' "$raw_line" \
        | grep -oE "[?:][[:space:]]+'[[:space:]]*[a-zA-Z_][a-zA-Z0-9_-]*[[:space:]]*'" \
        | grep -oE "'[[:space:]]*[a-zA-Z_][a-zA-Z0-9_-]*[[:space:]]*'" \
        | tr -d "'" \
        | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
        | while IFS= read -r branch_cls; do
            [[ -z "$branch_cls" ]] && continue
            is_known "$branch_cls" && continue
            printf '%s\t%s\t%d\n' "$branch_cls" "$rel_file" "$line_num"
          done >> "$TMP_ORPHANS" || true
    fi

    # ── 3c. String concat: className={'base' + (cond ? ' mod' : '')}
    # Only applies when the className value is a JS expression (className={...})
    # that is NOT a template literal (those are handled by 3b above).
    # Extract single-quoted tokens from the VALUE side of className={...} only —
    # not from comparison expressions like `imgState !== 'loaded'`.
    # We match patterns that start immediately after className={ and end before }
    # to avoid catching comparison strings like !== 'somestring'.
    if printf '%s' "$raw_line" | grep -qE "className=\{[^'\`]"; then
      # Extract className={...} expression value
      cls_expr="$(printf '%s' "$raw_line" | grep -oE "className=\{[^}]+\}" | head -1 || true)"
      if [[ -n "$cls_expr" ]]; then
        # Only look at string literals that appear as values in + concat or ternary result:
        # patterns like: 'classname', or after ? or : operators
        printf '%s\n' "$cls_expr" \
          | grep -oE "(className=\{[[:space:]]*|[+?:][[:space:]]*)'[a-zA-Z_][a-zA-Z0-9_ -]*'" \
          | grep -oE "'[a-zA-Z_][a-zA-Z0-9_ -]*'" \
          | tr -d "'" \
          | while IFS= read -r cls_group; do
              for cls in $cls_group; do
                [[ -z "$cls" ]] && continue
                is_known "$cls" && continue
                printf '%s\t%s\t%d\n' "$cls" "$rel_file" "$line_num"
              done
            done >> "$TMP_ORPHANS" || true
      fi
    fi

  done < "$tsx_file"
done < <(find "$JSX_GLOB" -name "*.tsx" ! -name "*.test.tsx" -type f | sort)

# ---------------------------------------------------------------------------
# 4. Report
# ---------------------------------------------------------------------------
orphan_count=0
[[ -f "$TMP_ORPHANS" ]] && orphan_count="$(wc -l < "$TMP_ORPHANS" | tr -d ' ')"

if [[ "$orphan_count" -eq 0 ]]; then
  echo "orphan-classname-check: PASS — all JSX classNames have matching CSS rules."
  exit 0
fi

echo ""
echo "orphan-classname-check: FAIL — ${orphan_count} orphan className(s) found."
echo ""
echo "Each className below is used in JSX but has no matching CSS selector"
echo "in the project CSS files:"
echo ""

while IFS=$'\t' read -r cls rel_file line_num; do
  printf '  className="%s" — %s:%s\n' "$cls" "$rel_file" "$line_num"
done < "$TMP_ORPHANS"

echo ""
echo "To fix:"
echo "  1. Add a CSS rule for the className in frontend/src/styles.css"
echo "     (or the relevant component CSS file), OR"
echo "  2. If the className is intentionally dynamic (non-ternary, non-union),"
echo "     add it to .github/orphan-classname-allowlist.yml with a comment."
echo ""

exit 1
