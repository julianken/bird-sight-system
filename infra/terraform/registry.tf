resource "google_artifact_registry_repository" "birdwatch" {
  repository_id = "birdwatch"
  location      = var.gcp_region
  format        = "DOCKER"
  description   = "Container images for bird-watch services"

  depends_on = [google_project_service.artifactregistry]
}

output "artifact_registry_url" {
  value = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}"
}
