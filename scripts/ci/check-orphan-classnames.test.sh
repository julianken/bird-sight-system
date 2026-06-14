#!/usr/bin/env bash
# check-orphan-classnames.test.sh
#
# Synthetic unit tests for scripts/ci/check-orphan-classnames.sh.
#
# Each test:
#   1. Creates a minimal tmp directory tree (CSS + TSX) that exercises a
#      specific extraction path.
#   2. Copies the script under scripts/ in the tmp tree so REPO_ROOT resolves
#      to the tmp root (the script auto-discovers REPO_ROOT from BASH_SOURCE[0]).
#   3. Runs the script and asserts on exit code + output.
#
# Usage:
#   bash scripts/ci/check-orphan-classnames.test.sh
#
# Compatibility: bash >= 3.2 (macOS stock).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT_SRC="${SCRIPT_DIR}/check-orphan-classnames.sh"

PASS=0
FAIL=0

# ---------------------------------------------------------------------------
# Helper: scaffold a minimal repo tree and run the check script inside it.
#
# Arguments:
#   $1  tmp_dir      — pre-created temp directory (caller owns cleanup)
#   $2  css_content  — contents for frontend/src/styles.css
#   $3  tsx_content  — contents for frontend/src/components/Test.tsx
#
# Stdout: script output (combined stdout/stderr)
# Exit code: forwarded from the script (never causes set -e to abort caller)
# ---------------------------------------------------------------------------
run_check() {
  local tmp_dir="$1"
  local css_content="$2"
  local tsx_content="$3"

  # Build the directory tree the script expects
  mkdir -p "${tmp_dir}/frontend/src/styles"
  mkdir -p "${tmp_dir}/frontend/src/components/ds"
  mkdir -p "${tmp_dir}/.github"
  mkdir -p "${tmp_dir}/scripts/ci"

  # CSS files — only styles.css gets real content; the rest are stubs
  printf '%s\n' "$css_content"  > "${tmp_dir}/frontend/src/styles.css"
  touch "${tmp_dir}/frontend/src/styles/tokens.css"
  touch "${tmp_dir}/frontend/src/styles/motion.css"
  touch "${tmp_dir}/frontend/src/components/ds/ds-primitives.css"

  # TSX component under test
  printf '%s\n' "$tsx_content"  > "${tmp_dir}/frontend/src/components/Test.tsx"

  # Empty allow-list (so tests are purely against the in-test CSS)
  printf ''                      > "${tmp_dir}/.github/orphan-classname-allowlist.yml"

  # Copy the script into the tmp tree's scripts/ci/ dir (mirroring its real
  # location) so that REPO_ROOT (derived from BASH_SOURCE[0] via `/../..`)
  # resolves to $tmp_dir, not the real repo root. Mirroring the real depth
  # also lets this test CATCH a depth regression in the script.
  cp "$CHECK_SCRIPT_SRC" "${tmp_dir}/scripts/ci/check-orphan-classnames.sh"

  bash "${tmp_dir}/scripts/ci/check-orphan-classnames.sh" 2>&1
}

assert_pass() {
  local label="$1" exit_code="$2" output="$3"
  if [[ "$exit_code" -eq 0 ]]; then
    printf 'PASS  %s\n' "$label"
    (( PASS++ )) || true
  else
    printf 'FAIL  %s — expected exit 0, got %d\n' "$label" "$exit_code"
    printf '      output: %s\n' "$output"
    (( FAIL++ )) || true
  fi
}

assert_fail() {
  local label="$1" exit_code="$2" output="$3" expected_cls="$4"
  if [[ "$exit_code" -ne 0 ]] && printf '%s\n' "$output" | grep -qF "$expected_cls"; then
    printf 'PASS  %s\n' "$label"
    (( PASS++ )) || true
  else
    printf 'FAIL  %s — expected exit 1 + "%s" in output\n' "$label" "$expected_cls"
    printf '      exit_code=%d\n' "$exit_code"
    printf '      output: %s\n' "$output"
    (( FAIL++ )) || true
  fi
}

# ---------------------------------------------------------------------------
# Test 1 — 3a: static string literal present in CSS → PASS
# ---------------------------------------------------------------------------
T1="$(mktemp -d /tmp/orphan-test-1.XXXXXX)"
CSS1='.known-class { color: red; }'
TSX1='export const T = () => <div className="known-class">x</div>;'
out1="$(run_check "$T1" "$CSS1" "$TSX1")" || ec1=$?; ec1="${ec1:-0}"
assert_pass "3a: known static string literal passes" "$ec1" "$out1"
rm -rf "$T1"

# ---------------------------------------------------------------------------
# Test 2 — 3a: static string literal NOT in CSS → FAIL (orphan-static detected)
# ---------------------------------------------------------------------------
T2="$(mktemp -d /tmp/orphan-test-2.XXXXXX)"
CSS2='.different-class { color: red; }'
TSX2='export const T = () => <div className="orphan-static">x</div>;'
out2="$(run_check "$T2" "$CSS2" "$TSX2")" || ec2=$?; ec2="${ec2:-0}"
assert_fail "3a: orphan static string literal fails" "$ec2" "$out2" "orphan-static"
rm -rf "$T2"

# ---------------------------------------------------------------------------
# Test 3 — 3b Bug1: template-literal static prefix present in CSS → PASS
#   className={`feed-row ${v}`}  →  "feed-row" must be extracted
# ---------------------------------------------------------------------------
T3="$(mktemp -d /tmp/orphan-test-3.XXXXXX)"
CSS3='.feed-row { display: flex; }'
TSX3="export const T = ({v}: {v: string}) => <div className={\`feed-row \${v}\`}>x</div>;"
out3="$(run_check "$T3" "$CSS3" "$TSX3")" || ec3=$?; ec3="${ec3:-0}"
assert_pass "3b Bug1: template static prefix in CSS passes" "$ec3" "$out3"
rm -rf "$T3"

# ---------------------------------------------------------------------------
# Test 4 — 3b Bug1: template-literal static prefix NOT in CSS → FAIL (orphan-base detected)
#   className={`orphan-base ${v}`}  →  "orphan-base" must be detected
# ---------------------------------------------------------------------------
T4="$(mktemp -d /tmp/orphan-test-4.XXXXXX)"
CSS4='.some-other-class { display: flex; }'
TSX4="export const T = ({v}: {v: string}) => <div className={\`orphan-base \${v}\`}>x</div>;"
out4="$(run_check "$T4" "$CSS4" "$TSX4")" || ec4=$?; ec4="${ec4:-0}"
assert_fail "3b Bug1: orphan template static prefix is detected" "$ec4" "$out4" "orphan-base"
rm -rf "$T4"

# ---------------------------------------------------------------------------
# Test 5 — 3b Bug2: ternary branch with leading space present in CSS → PASS
#   className={`feed-row${n ? ' is-notable' : ''}`}  →  "is-notable" must be extracted
# ---------------------------------------------------------------------------
T5="$(mktemp -d /tmp/orphan-test-5.XXXXXX)"
CSS5='.feed-row { display: flex; } .is-notable { font-weight: bold; }'
TSX5="export const T = ({n}: {n: boolean}) => <div className={\`feed-row\${n ? ' is-notable' : ''}\`}>x</div>;"
out5="$(run_check "$T5" "$CSS5" "$TSX5")" || ec5=$?; ec5="${ec5:-0}"
assert_pass "3b Bug2: space-prefixed ternary literal in CSS passes" "$ec5" "$out5"
rm -rf "$T5"

# ---------------------------------------------------------------------------
# Test 6 — 3b Bug2: ternary branch with leading space NOT in CSS → FAIL (orphan-branch detected)
#   className={`feed-row${n ? ' orphan-branch' : ''}`}  →  "orphan-branch" must be detected
# ---------------------------------------------------------------------------
T6="$(mktemp -d /tmp/orphan-test-6.XXXXXX)"
CSS6='.feed-row { display: flex; }'
TSX6="export const T = ({n}: {n: boolean}) => <div className={\`feed-row\${n ? ' orphan-branch' : ''}\`}>x</div>;"
out6="$(run_check "$T6" "$CSS6" "$TSX6")" || ec6=$?; ec6="${ec6:-0}"
assert_fail "3b Bug2: space-prefixed orphan ternary literal is detected" "$ec6" "$out6" "orphan-branch"
rm -rf "$T6"

# ---------------------------------------------------------------------------
# Test 7 — 3b Bug2: else branch with leading space NOT in CSS → FAIL (orphan-else detected)
#   className={`base${a ? 'known' : ' orphan-else'}`}  →  both sides checked
# ---------------------------------------------------------------------------
T7="$(mktemp -d /tmp/orphan-test-7.XXXXXX)"
CSS7='.base { display: flex; } .known { color: red; }'
TSX7="export const T = ({a}: {a: boolean}) => <div className={\`base\${a ? 'known' : ' orphan-else'}\`}>x</div>;"
out7="$(run_check "$T7" "$CSS7" "$TSX7")" || ec7=$?; ec7="${ec7:-0}"
assert_fail "3b Bug2: space-prefixed else-branch orphan is detected" "$ec7" "$out7" "orphan-else"
rm -rf "$T7"

# ---------------------------------------------------------------------------
# Test 8 — 3b: post-ternary static segment NOT in CSS → FAIL (orphan-extra detected)
#   className={`feed-row ${a ? 'x' : ''} orphan-extra`}  →  "orphan-extra" extracted
#   Verifies static segments that appear AFTER a ternary block are also checked.
# ---------------------------------------------------------------------------
T8="$(mktemp -d /tmp/orphan-test-8.XXXXXX)"
CSS8='.feed-row { display: flex; } .x { color: red; }'
TSX8="export const T = ({a}: {a: boolean}) => <div className={\`feed-row \${a ? 'x' : ''} orphan-extra\`}>x</div>;"
out8="$(run_check "$T8" "$CSS8" "$TSX8")" || ec8=$?; ec8="${ec8:-0}"
assert_fail "3b: post-ternary static segment orphan is detected" "$ec8" "$out8" "orphan-extra"
rm -rf "$T8"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
