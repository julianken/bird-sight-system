resource "google_artifact_registry_repository" "birdwatch" {
  repository_id = "birdwatch"
  location      = var.gcp_region
  format        = "DOCKER"
  description   = "Container images for bird-watch services"

  depends_on = [google_project_service.artifactregistry]
}

# ── gh-deploy SA: repo-scoped repoAdmin ─────────────────────────────────
#
# The gh-deploy@<project>.iam.gserviceaccount.com service account is used
# by every deploy-*.yml workflow via Workload Identity Federation. It needs
# `artifactregistry.tags.delete` to overwrite the `:latest` tag on each
# push to main (the "Promote SHA-tagged image to :latest" step).
#
# The project-level `roles/artifactregistry.writer` binding (managed
# manually outside Terraform) grants tags.create/update/get/list but NOT
# tags.delete — and `gcloud artifacts docker tags add` on an existing tag
# performs a delete+create. As a result every deploy-{read-api,ingestor,
# admin-api,migrations}.yml run has failed at the Promote step since
# 2026-05-03 (first re-tag attempt after first ship). repoAdmin scoped to
# the birdwatch repo is the minimum role that includes tags.delete +
# versions.delete; we deliberately do NOT widen the project-level writer
# role, and we keep the binding repo-scoped (not project-wide) so a
# compromised deploy SA cannot touch other Artifact Registry repos that
# might be added later.
resource "google_artifact_registry_repository_iam_member" "gh_deploy_repo_admin" {
  project    = google_artifact_registry_repository.birdwatch.project
  location   = google_artifact_registry_repository.birdwatch.location
  repository = google_artifact_registry_repository.birdwatch.name
  role       = "roles/artifactregistry.repoAdmin"
  member     = "serviceAccount:gh-deploy@${var.gcp_project_id}.iam.gserviceaccount.com"
}

output "artifact_registry_url" {
  value = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}"
}
