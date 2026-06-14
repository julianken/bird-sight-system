#!/usr/bin/env bash
# verify-backfill.sh — Phase 3.5 per-state backfill verifier.
#
# Reads Cloud Run Job executions + Cloud Logging summary lines, cross-references
# against the 50 expected USPS state codes, and prints a per-state status table
# with a rerun command for any failures. Read-only: no DB writes, no scheduler
# mutations, idempotent.
#
# Usage:
#   scripts/data/verify-backfill.sh [--since=ISO8601]
#
# Default --since: today 00:00 UTC.
#
# Requires: gcloud, jq.
# Hardcoded for the bird-maps-prod / us-west1 deployment — adjust if reusing.
#
# Exit code: 0 iff all 50 states have Succeeded executions since --since.

set -euo pipefail

PROJECT="bird-maps-prod"
REGION="us-west1"
JOB="bird-ingestor"

# Default --since: today 00:00 UTC.
DEFAULT_SINCE="$(date -u +%Y-%m-%dT00:00:00Z)"
SINCE="$DEFAULT_SINCE"

for arg in "$@"; do
  case "$arg" in
    --since=*) SINCE="${arg#--since=}" ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

for cmd in gcloud jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    exit 2
  fi
done

# 50 USPS codes; must match infra/terraform/ingestor.tf local.us_states.
STATES=(
  AL AK AZ AR CA CO CT DE FL GA
  HI ID IL IN IA KS KY LA ME MD
  MA MI MN MS MO MT NE NV NH NJ
  NM NY NC ND OH OK OR PA RI SC
  SD TN TX UT VT VA WA WV WI WY
)

# Fetch all executions for the job since --since, once. Filter+map locally to
# avoid 50 round-trips. Executions list returns yaml/json with the embedded
# containerOverrides args, status, completion times.
EXECUTIONS_JSON="$(gcloud run jobs executions list \
  --job="$JOB" \
  --region="$REGION" \
  --project="$PROJECT" \
  --format=json 2>/dev/null || echo '[]')"

# Fetch summary log lines (bird_ingest_run_completed) for the window, with
# state, status, duration_seconds. jsonPayload.state was added in the same PR
# that introduced this script — older runs will have state=null and show up
# as "missing" in the cross-reference. That's fine: this script is for the
# Phase 3.5 one-shot going forward.
LOGS_JSON="$(gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=\"$JOB\" AND jsonPayload.message=\"bird_ingest_run_completed\" AND timestamp>=\"$SINCE\"" \
  --project="$PROJECT" \
  --format=json \
  --limit=500 2>/dev/null || echo '[]')"

printf '%-6s  %-10s  %-20s  %-10s  %s\n' STATE STATUS EXECUTION DURATION RERUN
printf '%s\n' "----------------------------------------------------------------------------------------"

succeeded=0
failed=0
running=0
missing=0

for state in "${STATES[@]}"; do
  arg_match="--state=US-${state}"

  # Find the most recent execution matching this state since SINCE.
  exec_row="$(jq -r --arg since "$SINCE" --arg arg "$arg_match" '
    [ .[]
      | select(.metadata.creationTimestamp >= $since)
      | select(
          (.spec.template.spec.containers // .spec.template.template.spec.containers // [])[0].args
          | (. // []) | tostring | contains($arg)
        )
    ]
    | sort_by(.metadata.creationTimestamp) | reverse | .[0] // empty
    | "\(.metadata.name)\t\(.status.conditions // [] | map(select(.type=="Completed"))[0].status // "Unknown")\t\(.status.conditions // [] | map(select(.type=="Completed"))[0].reason // "")"
  ' <<<"$EXECUTIONS_JSON")"

  log_row="$(jq -r --arg state "US-${state}" '
    [ .[] | select(.jsonPayload.state == $state) ]
    | sort_by(.timestamp) | reverse | .[0] // empty
    | "\(.jsonPayload.status // "")\t\(.jsonPayload.duration_seconds // "")"
  ' <<<"$LOGS_JSON")"

  exec_name=""
  exec_status=""
  exec_reason=""
  if [[ -n "$exec_row" ]]; then
    exec_name="$(awk -F'\t' '{print $1}' <<<"$exec_row")"
    exec_status="$(awk -F'\t' '{print $2}' <<<"$exec_row")"
    exec_reason="$(awk -F'\t' '{print $3}' <<<"$exec_row")"
  fi

  log_status=""
  log_duration=""
  if [[ -n "$log_row" ]]; then
    log_status="$(awk -F'\t' '{print $1}' <<<"$log_row")"
    log_duration="$(awk -F'\t' '{print $2}' <<<"$log_row")"
  fi

  # Derive a verdict from the combination. Log line is authoritative when
  # present; falls back to execution condition.
  status="MISSING"
  if [[ "$log_status" == "success" ]]; then
    status="SUCCEEDED"
    succeeded=$((succeeded + 1))
  elif [[ "$log_status" == "partial" ]]; then
    status="PARTIAL"
    failed=$((failed + 1))
  elif [[ "$log_status" == "failure" ]]; then
    status="FAILED"
    failed=$((failed + 1))
  elif [[ "$exec_status" == "True" ]]; then
    status="SUCCEEDED"
    succeeded=$((succeeded + 1))
  elif [[ "$exec_status" == "False" ]]; then
    status="FAILED"
    failed=$((failed + 1))
  elif [[ -n "$exec_name" ]]; then
    status="RUNNING"
    running=$((running + 1))
  else
    missing=$((missing + 1))
  fi

  rerun=""
  if [[ "$status" == "FAILED" || "$status" == "PARTIAL" || "$status" == "MISSING" ]]; then
    rerun="gcloud run jobs execute $JOB --region=$REGION --project=$PROJECT --args=backfill,--state=US-${state},--back=14"
  fi

  printf '%-6s  %-10s  %-20s  %-10s  %s\n' \
    "US-${state}" "$status" "${exec_name:-—}" "${log_duration:-—}" "$rerun"
done

printf '\n50 states: %d succeeded, %d failed, %d running, %d missing\n' \
  "$succeeded" "$failed" "$running" "$missing"

if [[ "$succeeded" -eq 50 ]]; then
  exit 0
else
  exit 1
fi
