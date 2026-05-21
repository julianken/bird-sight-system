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
#   L1: `dashboard_json` diff-suppression silently drops remove-only edits.
#       To remove a widget cleanly, pair the removal with a non-removal
#       change (touch a title or description in the same Apply) — otherwise
#       Terraform reports a clean diff but the widget remains.
#   L6: `mosaicLayout.columns` is INTEGER (12), not string. `gridLayout
#       .columns` IS a string — different schemas. This dashboard uses
#       mosaicLayout exclusively; mixing the two produces a low-quality
#       server-side 400 at Apply.
#
# Also: `terraform validate` does NOT validate the contents of
# `dashboard_json`. Invented widget types pass validate but fail at Apply.
# Cross-check widget structs against the live Google Monitoring v3 schema
# (or copy a known-good widget from an existing dashboard) before adding
# new tile shapes.

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
        # ── Row 5: Observations archive pipeline (T8 of issue #689) ─────
        #
        # Visibility into the nightly prune's archive-then-delete pipeline.
        # The 14-day live retention window means raw row counts on the
        # observations table do NOT carry archive throughput — these tiles
        # are the only way to see the cold-storage data flow without
        # tailing Cloud Logging by hand.
        # Tile 5.1 — Rows archived per night
        {
          xPos   = 0
          yPos   = 16
          width  = 3
          height = 4
          widget = {
            title = "Archive throughput — rows per night (last 30d)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/bird-ingest-archived-row-count\" AND resource.type=\"cloud_run_job\""
                    aggregation = {
                      alignmentPeriod    = "86400s" # daily buckets
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
              yAxis = {
                label = "rows"
                scale = "LINEAR"
              }
            }
          }
        },
        # Tile 5.2 — Bytes uploaded per night
        {
          xPos   = 3
          yPos   = 16
          width  = 3
          height = 4
          widget = {
            title = "GCS bytes uploaded per night (last 30d)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/bird-ingest-archived-bytes-uploaded\" AND resource.type=\"cloud_run_job\""
                    aggregation = {
                      alignmentPeriod    = "86400s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
              yAxis = {
                label = "bytes"
                scale = "LINEAR"
              }
            }
          }
        },
        # Tile 5.3 — Archive vs Delete parity check
        # Two lines on one widget. For healthy nights the lines overlay
        # exactly (rowCount == deletedCount per the T2 atomic-per-day
        # invariant). Divergence is a visual smell — triage via the
        # runbook §Failure response.
        {
          xPos   = 6
          yPos   = 16
          width  = 3
          height = 4
          widget = {
            title = "Archive vs Delete parity (per-day)"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"logging.googleapis.com/user/bird-ingest-archived-row-count\" AND resource.type=\"cloud_run_job\""
                      aggregation = {
                        alignmentPeriod    = "86400s"
                        perSeriesAligner   = "ALIGN_SUM"
                        crossSeriesReducer = "REDUCE_SUM"
                      }
                    }
                  }
                  plotType       = "LINE"
                  legendTemplate = "archived (rowCount)"
                },
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"logging.googleapis.com/user/bird-ingest-archived-deleted-count\" AND resource.type=\"cloud_run_job\""
                      aggregation = {
                        alignmentPeriod    = "86400s"
                        perSeriesAligner   = "ALIGN_SUM"
                        crossSeriesReducer = "REDUCE_SUM"
                      }
                    }
                  }
                  plotType       = "LINE"
                  legendTemplate = "deleted (deletedCount)"
                },
              ]
              yAxis = {
                label = "rows"
                scale = "LINEAR"
              }
            }
          }
        },
        # Tile 5.4 — GCS bucket size growth (90d, with lifecycle annotation)
        # GCP-native metric — no log-based metric needed. The 90-day window
        # is chosen so the Nearline → Archive transition (which fires at
        # age=90d per T1's lifecycle_rule) is visible: bucket size growth-
        # rate inflects when old partitions transition out of Nearline
        # storage class — useful visual sanity check on the lifecycle rule.
        {
          xPos   = 9
          yPos   = 16
          width  = 3
          height = 4
          widget = {
            title = "GCS archive bucket size — 90d (Nearline → Archive transition visible)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"storage.googleapis.com/storage/total_bytes\" AND resource.type=\"gcs_bucket\" AND resource.label.bucket_name=\"bird-maps-prod-obs-archive\""
                    aggregation = {
                      alignmentPeriod    = "86400s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.storage_class"]
                    }
                  }
                }
                plotType       = "STACKED_AREA"
                legendTemplate = "$${resource.labels.storage_class}"
              }]
              yAxis = {
                label = "bytes"
                scale = "LINEAR"
              }
            }
          }
        },
      ]
    }
  })
}

output "dashboard_url" {
  description = "Console URL for the bird-watch overview dashboard"
  value       = "https://console.cloud.google.com/monitoring/dashboards/custom/${reverse(split("/", google_monitoring_dashboard.bird_watch_overview.id))[0]}?project=${var.gcp_project_id}"
}
