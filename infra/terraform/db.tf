resource "neon_project" "birdwatch" {
  org_id     = var.neon_org_id
  name       = "bird-watch"
  region_id  = "aws-us-west-2" # close to gcp_region
  pg_version = 16

  # Neon Free tier caps history retention at 6h (21600s). Exceeding this
  # causes the Neon API to reject the project-create request.
  # See: https://neon.tech/docs/introduction/plans
  history_retention_seconds = 21600
}

resource "neon_database" "main" {
  project_id = neon_project.birdwatch.id
  branch_id  = neon_project.birdwatch.default_branch_id
  name       = "birdwatch"
  owner_name = neon_project.birdwatch.database_user
}

# Neon Free tier permits ONE read_write endpoint per branch; the project's
# auto-created default endpoint occupies that slot. Defining a second
# `neon_endpoint` of type `read_write` here would cause Neon to reject the
# apply. We rely on the default endpoint exposed via `database_host` /
# `database_host_pooler` on the project resource (added in kislerdm/neon
# v0.7.0), so no separate endpoint resource is needed.

locals {
  neon_pooled_url = "postgres://${neon_project.birdwatch.database_user}:${neon_project.birdwatch.database_password}@${neon_project.birdwatch.database_host_pooler}/${neon_database.main.name}?sslmode=require"
}

output "neon_db_url" {
  value     = "postgres://${neon_project.birdwatch.database_user}:${neon_project.birdwatch.database_password}@${neon_project.birdwatch.database_host}/${neon_database.main.name}?sslmode=require"
  sensitive = true
}

# Pooled URL — what Cloud Run uses. Each connection is multiplexed via PgBouncer.
output "neon_pooled_url" {
  value     = local.neon_pooled_url
  sensitive = true
}
