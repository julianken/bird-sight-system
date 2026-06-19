terraform {
  backend "gcs" {
    bucket = "bird-maps-tfstate"
    prefix = "terraform/state"
  }

  required_version = ">= 1.6.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.30"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.20"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
