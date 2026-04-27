terraform {
  backend "gcs" {
    bucket = "bird-maps-tfstate"
    prefix = "terraform/state"
  }

  required_version = ">= 1.6.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.20"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.7"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.20"
    }
  }
}
