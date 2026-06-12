# ── Photo-judge eval secrets (issue #1016, part of #1010) ────────────────────
#
# Spec: docs/specs/2026-06-11-photo-judge-braintrust-eval-design.md §5.
#
# The photo-quality field-mark judge runs a Braintrust eval that calls Gemini
# Vision. Both the Gemini API key and the Braintrust API key live in GCP Secret
# Manager so the IaC path is ready when the deferred Cloud Run job lands. This
# iteration stages ONLY the two secret containers — no compute, no IAM binding,
# no secret version:
#
#   * No secret VERSION: real values are set out-of-band so they never touch
#     terraform.tfvars, plan output, or state JSON. Populate post-`terraform
#     apply` via (value piped on stdin, never echoed):
#       gcloud secrets versions add bird-watch-gemini-api-key \
#         --project=bird-maps-prod --data-file=- < /path/to/gemini-key
#       gcloud secrets versions add bird-watch-braintrust-api-key \
#         --project=bird-maps-prod --data-file=- < /path/to/braintrust-key
#     Same pattern as the SendGrid / R2 / Healthchecks secrets.
#
#   * No IAM binding and no SA var: the consuming service account arrives with
#     the deferred Cloud Run job (gated on Gemini clearing its agreement gate).
#     Binding an existing SA to secrets it cannot yet use is premature coupling
#     (YAGNI). The local/CI eval reads the keys from .env.local / CI secrets,
#     not from Secret Manager — these entries only stage the Cloud-Run-later
#     path.
#
# `replication { auto {} }` is the post-provider-v5 form (the `automatic = true`
# boolean was removed in google provider v5); matches the 8 existing secrets in
# ingestor.tf / digest.tf. secret_id is immutable post-create and carries the
# `bird-watch-` prefix convention.

resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "bird-watch-gemini-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret" "braintrust_api_key" {
  secret_id = "bird-watch-braintrust-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}
