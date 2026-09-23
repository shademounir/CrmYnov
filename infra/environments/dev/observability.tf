locals {
  observability_enabled = local.deploy_services
  alert_documentation   = <<-EOT
    DEV only. Inspect the affected Cloud Run revision or job and its correlated,
    expurgated logs before retrying. Do not expose credentials or applicant data.
    Runbook: docs/runbooks/gcp-dev-operations.md
  EOT
}

resource "google_monitoring_uptime_check_config" "web" {
  count              = local.observability_enabled ? 1 : 0
  project            = var.project_id
  display_name       = "CRM Ynov DEV Web health"
  checker_type       = "STATIC_IP_CHECKERS"
  period             = "60s"
  timeout            = "10s"
  selected_regions   = ["EUROPE", "USA", "ASIA_PACIFIC"]
  log_check_failures = true
  user_labels        = local.labels

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = trimprefix(google_cloud_run_v2_service.web[0].uri, "https://")
      project_id = var.project_id
    }
  }
  http_check {
    path           = "/api/health"
    port           = 443
    request_method = "GET"
    use_ssl        = true
    validate_ssl   = true
  }
  depends_on = [google_project_service.runtime, google_cloud_run_v2_service_iam_member.public_web]
}

resource "google_monitoring_alert_policy" "web_unavailable" {
  count                 = local.observability_enabled ? 1 : 0
  project               = var.project_id
  display_name          = "CRM DEV Web unavailable"
  combiner              = "OR"
  enabled               = true
  severity              = "CRITICAL"
  notification_channels = var.alert_notification_channels
  user_labels           = local.labels
  conditions {
    display_name = "Uptime check failed"
    condition_threshold {
      filter          = "resource.type = \"uptime_url\" AND metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id = \"${google_monitoring_uptime_check_config.web[0].uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"
      }
      trigger { count = 1 }
    }
  }
  documentation {
    content   = local.alert_documentation
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "run_5xx" {
  for_each              = local.observability_enabled ? toset(["crm-dev-api", "crm-dev-web"]) : toset([])
  project               = var.project_id
  display_name          = "CRM DEV ${each.value} HTTP 5xx"
  combiner              = "OR"
  enabled               = true
  severity              = "ERROR"
  notification_channels = var.alert_notification_channels
  user_labels           = local.labels
  conditions {
    display_name = "At least one 5xx in five minutes"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.label.service_name = \"${each.value}\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.label.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }
      trigger { count = 1 }
    }
  }
  documentation {
    content   = local.alert_documentation
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "cloudsql_cpu" {
  count                 = local.observability_enabled ? 1 : 0
  project               = var.project_id
  display_name          = "CRM DEV Cloud SQL CPU saturation"
  combiner              = "OR"
  enabled               = true
  severity              = "WARNING"
  notification_channels = var.alert_notification_channels
  user_labels           = local.labels
  conditions {
    display_name = "CPU above 80 percent for five minutes"
    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND resource.label.database_id = \"${var.project_id}:${google_sql_database_instance.postgres.name}\" AND metric.type = \"cloudsql.googleapis.com/database/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
      trigger { count = 1 }
    }
  }
  documentation {
    content   = local.alert_documentation
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "due_job_failure" {
  count                 = local.observability_enabled ? 1 : 0
  project               = var.project_id
  display_name          = "CRM DEV due notification job failure"
  combiner              = "OR"
  enabled               = true
  severity              = "ERROR"
  notification_channels = var.alert_notification_channels
  user_labels           = local.labels
  conditions {
    display_name = "Cloud Run due job emitted an error"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"crm-dev-follow-up-due\" AND severity>=ERROR"
    }
  }
  alert_strategy {
    auto_close = "1800s"
    notification_rate_limit {
      period = "300s"
    }
  }
  documentation {
    content   = local.alert_documentation
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "telephony_command_failure" {
  count                 = local.observability_enabled ? 1 : 0
  project               = var.project_id
  display_name          = "CRM DEV telephony command blocked"
  combiner              = "OR"
  enabled               = true
  severity              = "WARNING"
  notification_channels = var.alert_notification_channels
  user_labels           = local.labels
  conditions {
    display_name = "Agent command endpoint returned an error"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"crm-dev-web\" AND log_id(\"run.googleapis.com/requests\") AND httpRequest.requestUrl:\"/agent/integrations/telephony/agent/v1/\" AND httpRequest.status>=400"
    }
  }
  alert_strategy {
    auto_close = "1800s"
    notification_rate_limit {
      period = "300s"
    }
  }
  documentation {
    content   = local.alert_documentation
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_dashboard" "runtime" {
  count   = local.observability_enabled ? 1 : 0
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "CRM Ynov DEV runtime"
    labels      = local.labels
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          xPos = 0, yPos = 0, width = 6, height = 4
          widget = {
            title = "Web/API requests"
            xyChart = { dataSets = [{
              plotType = "LINE"
              timeSeriesQuery = { timeSeriesFilter = {
                filter      = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\""
                aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["resource.label.service_name"] }
              } }
            }] }
          }
        },
        {
          xPos = 6, yPos = 0, width = 6, height = 4
          widget = {
            title = "Web/API request latency p95"
            xyChart = { dataSets = [{
              plotType = "LINE"
              timeSeriesQuery = { timeSeriesFilter = {
                filter      = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_latencies\""
                aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_PERCENTILE_95", crossSeriesReducer = "REDUCE_MAX", groupByFields = ["resource.label.service_name"] }
              } }
            }] }
          }
        },
        {
          xPos = 0, yPos = 4, width = 6, height = 4
          widget = {
            title = "Cloud SQL CPU"
            xyChart = { dataSets = [{
              plotType = "LINE"
              timeSeriesQuery = { timeSeriesFilter = {
                filter      = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
                aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" }
              } }
            }] }
          }
        },
        {
          xPos = 6, yPos = 4, width = 6, height = 4
          widget = {
            title = "Cloud Run instances"
            xyChart = { dataSets = [{
              plotType = "LINE"
              timeSeriesQuery = { timeSeriesFilter = {
                filter      = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/container/instance_count\""
                aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["resource.label.service_name"] }
              } }
            }] }
          }
        }
      ]
    }
  })
  depends_on = [google_project_service.runtime]
}
