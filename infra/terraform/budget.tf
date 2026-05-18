# ── P0.k: GCP billing budget alerts ──────────────────────────────────────
#
# Phase 0 finisher for the going-national plan §7. Single $100/month budget
# scoped to project `bird-maps-prod`, with two thresholds:
#   - 0.5  (warn at  $50 of $100 — early signal)
#   - 1.0  (critical at $100 — at-budget, page-worthy)
#
# Notifications route to the existing
# google_monitoring_notification_channel.email_julian declared in
# monitoring.tf. Default IAM recipients are disabled so the alert fans out
# only via the explicit channel — keeps spam off the billing-admin role.
#
# Operator action required before `terraform apply`:
#   1. Run `gcloud beta billing accounts list` to find the billing account ID
#      (shape: 0XXXXX-0XXXXX-0XXXXX). Confirm it's the one linked to
#      bird-maps-prod via `gcloud beta billing projects describe bird-maps-prod`.
#   2. Set `gcp_billing_account_id` in terraform.tfvars (see *.example).
#
# Provider note: google_billing_budget shape verified against
# hashicorp/google ~> 7.30 via context7 on 2026-05-17.

data "google_billing_account" "account" {
  billing_account = var.gcp_billing_account_id
}

resource "google_billing_budget" "monthly_spend" {
  billing_account = data.google_billing_account.account.id
  display_name    = "bird-maps-prod monthly spend ($100)"

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
    # Default: includes all services in the project. Cross-project spend
    # is excluded by the projects filter above.
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "100"
    }
  }

  # Warn at 50% ($50), critical at 100% ($100). Both fire on CURRENT_SPEND;
  # FORECASTED_SPEND would page earlier in the month and is overkill for v1.
  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = [
      google_monitoring_notification_channel.email_julian.id,
    ]
    disable_default_iam_recipients = true
  }
}
