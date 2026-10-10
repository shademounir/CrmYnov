resource "google_monitoring_notification_channel" "operations" {
  project      = local.project_id
  display_name = "CRM ${var.environment} operations"
  type         = "email"
  labels       = { email_address = var.operations_alert_email }
  enabled      = true
  depends_on   = [google_project_service.runtime]
}
resource "google_billing_budget" "runtime" {
  billing_account = var.billing_account_id
  display_name    = "CRM Ynov ${upper(var.environment)} runtime monthly alert"
  budget_filter {
    projects               = ["projects/${data.google_project.current.number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = "150"
    }
  }
  dynamic "threshold_rules" {
    for_each = toset([0.5, 0.8, 1.0])
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
  all_updates_rule {
    monitoring_notification_channels = [google_monitoring_notification_channel.operations.id]
    disable_default_iam_recipients   = false
  }
  lifecycle { prevent_destroy = true }
}
resource "google_monitoring_uptime_check_config" "web" {
  count            = var.deploy_services ? 1 : 0
  project          = local.project_id
  display_name     = "CRM ${var.environment} Web health"
  checker_type     = "STATIC_IP_CHECKERS"
  period           = "60s"
  timeout          = "10s"
  selected_regions = ["EUROPE", "USA", "ASIA_PACIFIC"]
  monitored_resource {
    type   = "uptime_url"
    labels = { host = trimprefix(google_cloud_run_v2_service.web[0].uri, "https://"), project_id = local.project_id }
  }
  http_check {
    path           = "/api/health"
    port           = 443
    request_method = "GET"
    use_ssl        = true
    validate_ssl   = true
  }
  depends_on = [google_cloud_run_v2_service_iam_member.public_web]
}
resource "google_monitoring_alert_policy" "web_unavailable" {
  count                 = var.deploy_services ? 1 : 0
  project               = local.project_id
  display_name          = "CRM ${var.environment} Web unavailable"
  combiner              = "OR"
  enabled               = true
  notification_channels = [google_monitoring_notification_channel.operations.id]
  user_labels           = local.labels
  conditions {
    display_name = "Uptime check failed for two minutes"
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
    content   = "${var.environment} pilot only. Correlate revision and expurgated logs before any retry. Alert receipt and RPO/RTO are not proved by resource creation."
    mime_type = "text/markdown"
  }
}
resource "google_monitoring_alert_policy" "job_failure" {
  count                 = local.deploy_jobs ? 1 : 0
  project               = local.project_id
  display_name          = "CRM ${var.environment} due job failure"
  combiner              = "OR"
  enabled               = true
  notification_channels = [google_monitoring_notification_channel.operations.id]
  user_labels           = local.labels
  conditions {
    display_name = "Follow-up due job error"
    condition_matched_log { filter = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${local.prefix}-follow-up-due\" AND severity>=ERROR" }
  }
  alert_strategy {
    auto_close = "1800s"
    notification_rate_limit { period = "300s" }
  }
}
