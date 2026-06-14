#!/usr/bin/env bash
# Backfill photos for AZ-observed species that landed in the silhouette-fallback
# bucket after a prior `bird-ingestor-photos` run. Targets the ~23 species the
# #483 cohort observed live on 2026-05-12 (warblers, flycatcher vagrants, etc.)
# where the iNat AZ -> US -> global cascade from PR #350 returned null.
#
# Mechanism: invokes the existing `photos` CLI kind. `runPhotos` skips species
# that already have a `detail-panel` photo (forceRefresh=false, the default),
# so this script is naturally scoped to the residual cohort — no per-species
# list is needed. The Wikipedia lead-image fallback wired in #483 fires per
# species when the iNat cascade exhausts, lifting coverage from ~94% to the
# target >98% set by the issue's acceptance criteria.
#
# Run modes:
#   local      Direct against a DATABASE_URL the operator already has in
#              their shell. Useful for the first dry-run before scheduling.
#   prod       Execute the `bird-ingestor` Cloud Run job with --args=photos.
#              The job's environment already has DATABASE_URL + EBIRD_API_KEY
#              wired via Secret Manager; no extra plumbing needed.
#
# Flags:
#   --dry-run  Print the command that would be invoked and exit 0. Useful for
#              the PR-review readout where the live run isn't appropriate.
#
# Example:
#   scripts/data/backfill-residual-photos.sh local --dry-run
#   scripts/data/backfill-residual-photos.sh prod
#
# Followups (manual):
#   - `gh issue view 483 --comment` with the resulting `photosFromWikipedia`
#     counter once the run completes.
#   - Re-sample `https://api.bird-maps.com/api/observations?since=14d` and
#     re-bucket by `photo_url == null` to confirm the residual rate dropped.
set -euo pipefail

MODE="${1:-local}"
DRY_RUN="${2:-}"

# Cloud Run job + region pinned to the prod project. These mirror the values
# in infra/terraform/ingestor.tf; changes there must mirror back here.
GCP_PROJECT="${GCP_PROJECT:-bird-maps-prod}"
GCP_REGION="${GCP_REGION:-us-west1}"
JOB_NAME="${JOB_NAME:-bird-ingestor}"

invoke_local() {
  : "${DATABASE_URL:?DATABASE_URL must be set for local mode}"
  : "${EBIRD_API_KEY:?EBIRD_API_KEY must be set for local mode}"
  echo "[backfill-residual-photos] local mode: invoking photos runner against \$DATABASE_URL"
  npm run --workspace @bird-watch/ingestor ingest:local photos
}

invoke_prod() {
  echo "[backfill-residual-photos] prod mode: executing Cloud Run job ${JOB_NAME} (--args=photos) in ${GCP_REGION}/${GCP_PROJECT}"
  gcloud run jobs execute "${JOB_NAME}" \
    --args=photos \
    --region="${GCP_REGION}" \
    --project="${GCP_PROJECT}" \
    --wait
}

case "${MODE}" in
  local)
    if [[ "${DRY_RUN}" == "--dry-run" ]]; then
      echo "[backfill-residual-photos] DRY-RUN: would invoke 'npm run --workspace @bird-watch/ingestor ingest:local photos'"
      exit 0
    fi
    invoke_local
    ;;
  prod)
    if [[ "${DRY_RUN}" == "--dry-run" ]]; then
      echo "[backfill-residual-photos] DRY-RUN: would invoke 'gcloud run jobs execute ${JOB_NAME} --args=photos --region=${GCP_REGION} --project=${GCP_PROJECT} --wait'"
      exit 0
    fi
    invoke_prod
    ;;
  *)
    echo "Usage: $0 (local|prod) [--dry-run]" >&2
    exit 2
    ;;
esac
