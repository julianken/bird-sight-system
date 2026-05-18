provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region

  # Required for google_billing_budget and other API-key-quota'd resources.
  # See https://cloud.google.com/docs/authentication/adc-troubleshooting/user-creds
  billing_project       = var.gcp_project_id
  user_project_override = true
}

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
