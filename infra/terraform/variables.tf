variable "gcp_project_id" {
  type        = string
  description = "GCP project ID (create one at console.cloud.google.com)."
}

variable "gcp_region" {
  type        = string
  default     = "us-west1"
  description = "Cloud Run + Artifact Registry region. us-west1 keeps latency to AZ users low."
}

variable "neon_api_key" {
  type        = string
  sensitive   = true
  description = "Neon API key (Neon dashboard → Settings → API keys)."
}

variable "neon_org_id" {
  type        = string
  description = "Neon organization ID (visible in console URL after sign-in, e.g. org-green-boat-15736536)."
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID (used for Pages + DNS only)."
}

variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  description = "Cloudflare API token with Pages + DNS perms."
}

variable "cloudflare_zone_id" {
  type        = string
  sensitive   = true
  description = "Cloudflare zone ID for `domain`."
}

variable "ebird_api_key" {
  type        = string
  sensitive   = true
  description = "eBird API key (ebird.org/api/keygen)."
}

variable "domain" {
  type        = string
  description = "Domain you control on Cloudflare, e.g. birdwatch.example.com"
}

variable "frontend_origins" {
  type        = string
  default     = "https://bird-maps.com,https://www.bird-maps.com"
  description = "Comma-separated CORS origin allowlist injected into the read-api Cloud Run service as FRONTEND_ORIGINS. Non-sensitive (a public CORS list, not a secret)."
  # Production-only origins. Local dev relies on the hardcoded fallback in
  # services/read-api/src/app.ts; dev origins must NOT be added here.
}
