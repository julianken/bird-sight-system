resource "neon_project" "birdwatch" {
  name       = "bird-watch"
  region_id  = "aws-us-west-2" # close to gcp_region
  pg_version = 16
}

resource "neon_branch" "main" {
  project_id = neon_project.birdwatch.id
  name       = "main"
}

resource "neon_database" "main" {
  project_id = neon_project.birdwatch.id
  branch_id  = neon_branch.main.id
  name       = "birdwatch"
  owner_name = neon_project.birdwatch.database_user
}

# Endpoint with pooled connection enabled — required for serverless.
resource "neon_endpoint" "main" {
  project_id     = neon_project.birdwatch.id
  branch_id      = neon_branch.main.id
  type           = "read_write"
  pooler_enabled = true
}

# neon_project exposes database_host_pooler directly (added in provider v0.7.0),
# so no regex manipulation is needed.
locals {
  neon_pooled_url = "postgres://${neon_project.birdwatch.database_user}:${neon_project.birdwatch.database_password}@${neon_project.birdwatch.database_host_pooler}/${neon_database.main.name}?sslmode=require"
}

output "neon_db_url" {
  value     = "postgres://${neon_project.birdwatch.database_user}:${neon_project.birdwatch.database_password}@${neon_endpoint.main.host}/${neon_database.main.name}?sslmode=require"
  sensitive = true
}

# Pooled URL — what Cloud Run uses. Each connection is multiplexed via PgBouncer.
output "neon_pooled_url" {
  value     = local.neon_pooled_url
  sensitive = true
}
