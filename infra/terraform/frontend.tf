resource "cloudflare_pages_project" "frontend" {
  account_id        = var.cloudflare_account_id
  name              = "birdwatch"
  production_branch = "main"
}

resource "cloudflare_pages_domain" "root" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.frontend.name
  domain       = var.domain
}

# Apex "@" → CNAME to the Pages project's auto-assigned pages.dev subdomain.
# cloudflare_pages_domain binds the domain on the Pages side but does NOT
# create the DNS record; without this resource the zone serves NXDOMAIN for
# the apex. Reference the provider-exposed `subdomain` attribute rather than
# hardcoding "birdwatch-1xe.pages.dev" — if the project is ever recreated,
# Cloudflare may assign a different pages.dev suffix. proxied=true lets CF
# auto-flatten the apex CNAME.
resource "cloudflare_record" "root" {
  zone_id = var.cloudflare_zone_id
  name    = "@"
  type    = "CNAME"
  content = cloudflare_pages_project.frontend.subdomain
  proxied = true
  ttl     = 1
}

# Subdomain "api" → CNAME to Cloud Run's documented CNAME target.
# Cloud Run rejects requests whose Host header is not a registered domain
# mapping, so pointing straight at the run.app URL returns 404. The canonical
# path is a CNAME to ghs.googlehosted.com plus a google_cloud_run_domain_mapping
# below; proxied MUST be false so Cloud Run's own Let's Encrypt cert serves
# (proxying through Cloudflare breaks the SSL handshake).
resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  type    = "CNAME"
  content = "ghs.googlehosted.com"
  proxied = false
  ttl     = 1
}

# NOTE: google_cloud_run_domain_mapping is the v1-Knative resource. The rest
# of the infra uses google_cloud_run_v2_service, but the v2 provider does
# not yet expose a domain-mapping resource; the v1 resource is the canonical
# path and the v1/v2 mix is intentional here. Prerequisite: the operator
# must verify `var.domain` in Google Search Console (one-time out-of-band
# TXT record) before `terraform apply` — otherwise this resource fails.
resource "google_cloud_run_domain_mapping" "api" {
  location = var.gcp_region
  name     = "api.${var.domain}"

  metadata {
    namespace = var.gcp_project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.read_api.name
  }
}

output "api_url" {
  value = "https://api.${var.domain}"
}

output "frontend_url" {
  value = "https://${var.domain}"
}

output "root_domain" {
  value = var.domain
}

output "gcp_region" {
  value = var.gcp_region
}

# Consumed by scripts/deploy.sh to authenticate `wrangler pages deploy`
# for the one-shot deploy flow. Marked sensitive so `terraform apply`
# does not echo it; the operator still retrieves it via
# `terraform output -raw cloudflare_api_token`.
output "cloudflare_api_token" {
  value     = var.cloudflare_api_token
  sensitive = true
}
