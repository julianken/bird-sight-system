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

# Subdomain "api" → CNAME to the Cloud Run service URL (proxied through Cloudflare for caching).
resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  type    = "CNAME"
  # Strip protocol; CF wants just the host
  value   = trimprefix(google_cloud_run_v2_service.read_api.uri, "https://")
  proxied = true
  ttl     = 1
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
