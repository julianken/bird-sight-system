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
