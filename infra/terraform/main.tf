provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region

  # Required for google_billing_budget and other API-key-quota'd resources.
  # See https://cloud.google.com/docs/authentication/adc-troubleshooting/user-creds
  billing_project       = var.gcp_project_id
  user_project_override = true
}

# Neon provider — retained ONLY to allow terraform to plan/apply the destroy
# of the remaining `neon_project` / `neon_database` resources still in state
# from PRs prior to this Neon decommission. A follow-up PR removes this block
# (and the corresponding entries in versions.tf / variables.tf) once
# `terraform apply` confirms the state is clean.
provider "neon" {
  api_key = var.neon_api_key
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# Enable required GCP APIs once
resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}
resource "google_project_service" "scheduler" {
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}
resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}
resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}
