# ── bird-watch overview dashboard ─────────────────────────────────────────
#
# Single-pane operator view: open incidents, ingest health, read-api latency,
# Cloud SQL, system signals. Designed for un-paged triage — when an operator
# opens this during a routine check, they should resolve "is anything
# currently on fire", "did everything that was supposed to run, run", and
# "is anything trending toward unhealthy" in under 30 seconds.
#
# Landmines (per docs/analyses/2026-05-18-monitoring-dashboard-issue-638
# /phase-4/analysis-report.md §F4 / Iterator 2):
#   L1: `terraform validate` does NOT validate dashboard_json content.
#       Invented widget types pass validate but fail at Apply. Cross-check
#       widget structs against the live Google Monitoring v3 schema (or copy
#       a known-good widget from an existing dashboard) before adding new
#       tile shapes.
#   L6: `mosaicLayout.columns` is INTEGER (12), not string. `gridLayout
#       .columns` IS a string — different schemas. This dashboard uses
#       mosaicLayout exclusively; mixing the two produces a low-quality
#       server-side 400 at Apply.
#
# Diff-suppression caveat: legitimate remove-only edits to `dashboard_json`
# are silently dropped by the provider unless paired with a non-removal
# change. To remove a widget cleanly, touch a title or description in the
# same Apply so the provider sees a non-empty diff.

resource "google_monitoring_dashboard" "bird_watch_overview" {
  project = var.gcp_project_id
  dashboard_json = jsonencode({
    displayName = "bird-watch overview"
    mosaicLayout = {
      columns = 12
      tiles = [
        # Row 1: API health (read-api)
        # Tile 1.1 — req/s by status class
        {
          xPos   = 0
          yPos   = 0
          width  = 4
          height = 4
          widget = {
            title = "Read-API request rate by status class"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.response_code_class"]
                    }
                  }
                }
                plotType = "STACKED_AREA"
              }]
            }
          }
        },
        # Tile 1.2 — p95 latency
        {
          xPos   = 4
          yPos   = 0
          width  = 4
          height = 4
          widget = {
            title = "Read-API p95 latency (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"run.googleapis.com/request_latencies\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_PERCENTILE_95"
                      crossSeriesReducer = "REDUCE_MAX"
                    }
                  }
                }
                plotType = "LINE"
              }]
              thresholds = [{ value = 2000 }]
              yAxis = {
                label = "ms"
                scale = "LINEAR"
              }
            }
          }
        },
        # Tile 1.3 — open incidents (firing alert policies)
        {
          xPos   = 8
          yPos   = 0
          width  = 4
          height = 4
          widget = {
            title = "Open incidents (S1–S5 + uptime)"
            incidentList = {
              monitoredResources = []
              policyNames        = []
            }
          }
        },
        # Row 2: Ingester health
        # Tile 2.1 — completed runs by kind+status (replaces by-job_name)
        {
          xPos   = 0
          yPos   = 4
          width  = 4
          height = 4
          widget = {
            title = "Ingest runs by kind+status (1h buckets)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/bird-ingest-run-completed\" AND resource.type=\"cloud_run_job\""
                    aggregation = {
                      alignmentPeriod    = "3600s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.kind", "metric.label.status"]
                    }
                  }
                }
                plotType = "STACKED_BAR"
              }]
            }
          }
        },
        # Tile 2.2 — p95 duration by kind
        {
          xPos   = 4
          yPos   = 4
          width  = 4
          height = 4
          widget = {
            title = "Ingest run p95 duration by kind"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/bird-ingest-run-duration-seconds\" AND resource.type=\"cloud_run_job\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_PERCENTILE_95"
                      crossSeriesReducer = "REDUCE_MAX"
                      groupByFields      = ["metric.label.kind"]
                    }
                  }
                }
                plotType = "LINE"
              }]
              yAxis = {
                label = "seconds"
                scale = "LINEAR"
              }
            }
          }
        },
        # Tile 2.3 — data staleness gauge (existing meta_freshness metric)
        {
          xPos   = 8
          yPos   = 4
          width  = 4
          height = 4
          widget = {
            title = "Data freshness p95 (meta_freshness_seconds)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/bird-meta-freshness-seconds\" AND resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_PERCENTILE_95"
                      crossSeriesReducer = "REDUCE_MAX"
                    }
                  }
                }
                plotType = "LINE"
              }]
              thresholds = [{ value = 21600 }]
              yAxis = {
                label = "seconds"
                scale = "LINEAR"
              }
            }
          }
        },
        # Row 3: Cloud SQL
        # Tile 3.1 — CPU
        {
          xPos   = 0
          yPos   = 8
          width  = 4
          height = 4
          widget = {
            title = "Cloud SQL CPU utilization"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.gcp_project_id}:birdwatch-pg16\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_MAX"
                    }
                  }
                }
                plotType = "LINE"
              }]
              thresholds = [{ value = 0.8 }]
            }
          }
        },
        # Tile 3.2 — active connections
        {
          xPos   = 4
          yPos   = 8
          width  = 4
          height = 4
          widget = {
            title = "Cloud SQL active connections"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.gcp_project_id}:birdwatch-pg16\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        },
        # Tile 3.3 — disk utilization
        {
          xPos   = 8
          yPos   = 8
          width  = 4
          height = 4
          widget = {
            title = "Cloud SQL disk utilization"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"cloudsql.googleapis.com/database/disk/utilization\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.gcp_project_id}:birdwatch-pg16\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_MAX"
                    }
                  }
                }
                plotType = "LINE"
              }]
              thresholds = [{ value = 0.8 }]
            }
          }
        },
        # Row 4: System signals
        # Tile 4.1 — container crashes / OOM
        {
          xPos   = 0
          yPos   = 12
          width  = 4
          height = 4
          widget = {
            title = "Container crash / OOM (1h sum)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/bird-container-crash\" AND resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod    = "3600s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "STACKED_BAR"
              }]
            }
          }
        },
        # Tile 4.2 — uptime check (failing regions)
        {
          xPos   = 4
          yPos   = 12
          width  = 4
          height = 4
          widget = {
            title = "Read-API uptime — failing regions"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_NEXT_OLDER"
                      crossSeriesReducer = "REDUCE_COUNT_FALSE"
                      groupByFields      = ["resource.label.*"]
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        },
      ]
    }
  })
}

output "dashboard_url" {
  value = "https://console.cloud.google.com/monitoring/dashboards/custom/${trimprefix(google_monitoring_dashboard.bird_watch_overview.id, "projects/${var.gcp_project_id}/dashboards/")}?project=${var.gcp_project_id}"
}
