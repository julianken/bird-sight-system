#!/usr/bin/env bash
# Shape-2 rollup-probe: re-runs Iterator 1's 9 curls against
# /data/obs/{region}/recent and asserts each row count falls inside an
# expected band. See docs/plans/2026-05-17-shape-2-rollup-probe.md.
#
# Inputs:
#   $EBIRD_KEY     — required, eBird API key (GitHub Actions secret).
#   $HISTORY_CSV   — optional path to append a row to; default
#                    docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv
# Output:
#   $GITHUB_OUTPUT — writes all_pass=true|false and counts_json=[...]
#                    when running under GitHub Actions; harmless locally.
# Exit:
#   0 if all 9 curls pass their band; 1 otherwise; 2 on missing key.

set -euo pipefail

BANDS_FILE="$(dirname "$0")/shape-2-bands.json"
HISTORY_CSV="${HISTORY_CSV:-docs/analyses/2026-05-14-process-scale-options/o2-probe-history.csv}"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -z "${EBIRD_KEY:-}" ]]; then
  echo "EBIRD_KEY not set" >&2
  exit 2
fi

fetch_count() {
  # Issues a single curl, returns the JSON-array length. Retries once after
  # 60s on non-200 or non-array body.
  local path="$1"
  local attempt body count
  for attempt in 1 2; do
    body=$(curl -sS -H "X-eBirdApiToken: $EBIRD_KEY" "https://api.ebird.org${path}" || echo '')
    count=$(echo "$body" | jq 'if type == "array" then length else -1 end' 2>/dev/null || echo -1)
    if [[ "$count" -ge 0 ]]; then
      echo "$count"
      return 0
    fi
    if [[ $attempt -eq 1 ]]; then sleep 60; fi
  done
  echo -1
}

declare -a counts
all_pass=true
n=$(jq '.curls | length' "$BANDS_FILE")
for i in $(seq 0 $((n - 1))); do
  path=$(jq -r ".curls[$i].path" "$BANDS_FILE")
  mode=$(jq -r ".curls[$i].mode" "$BANDS_FILE")
  name=$(jq -r ".curls[$i].name" "$BANDS_FILE")
  c=$(fetch_count "$path")
  counts+=("$c")
  if [[ "$mode" == "exact" ]]; then
    want=$(jq -r ".curls[$i].value" "$BANDS_FILE")
    if [[ "$c" -ne "$want" ]]; then
      echo "FAIL curl $((i+1)) $name: got $c, want exactly $want" >&2
      all_pass=false
    else
      echo "PASS curl $((i+1)) $name: $c"
    fi
  else
    low=$(jq -r ".curls[$i].low" "$BANDS_FILE")
    high=$(jq -r ".curls[$i].high" "$BANDS_FILE")
    if [[ "$c" -lt "$low" || "$c" -gt "$high" ]]; then
      echo "FAIL curl $((i+1)) $name: got $c, want [$low..$high]" >&2
      all_pass=false
    else
      echo "PASS curl $((i+1)) $name: $c in [$low..$high]"
    fi
  fi
done

# Append CSV row (works locally and in CI).
row="$TS"
for c in "${counts[@]}"; do row="$row,$c"; done
row="$row,$all_pass"
mkdir -p "$(dirname "$HISTORY_CSV")"
if [[ ! -f "$HISTORY_CSV" ]]; then
  echo "ts,curl_1_us_back1,curl_2_us_back1_max100,curl_3_us_az_back1_max5_full,curl_4_us_ca_back1_max5,curl_5_us_ca_back1_max10k,curl_6_us_az_back1_max10k,curl_7_us_wy_back1_max10k,curl_8_us_back14,curl_9_us_az_back14,all_pass" > "$HISTORY_CSV"
fi
echo "$row" >> "$HISTORY_CSV"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "all_pass=$all_pass" >> "$GITHUB_OUTPUT"
  printf 'counts_json=[%s]\n' "$(IFS=,; echo "${counts[*]}")" >> "$GITHUB_OUTPUT"
fi

if [[ "$all_pass" == "true" ]]; then exit 0; else exit 1; fi
