locals {
  project = "crmynov-prod-n7x4q2"
  region  = "europe-west1"
  domain  = "crm.ynov.ma"
  prefix  = "crm-prod-edge"
}

provider "google" {
  project = local.project
  region  = local.region
}

variable "activate_https" {
  description = "Only after the compatible crm-prod-web service, origin and DNS handoff are qualified. False reserves DNS values without exposing a backend."
  type        = bool
  default     = false
}

resource "google_project_service" "certificates" {
  project            = local.project
  service            = "certificatemanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_global_address" "web" {
  project      = local.project
  name         = "${local.prefix}-ipv4"
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
  lifecycle { prevent_destroy = true }
}

resource "google_certificate_manager_dns_authorization" "crm" {
  project    = local.project
  location   = "global"
  name       = "${local.prefix}-dns"
  domain     = local.domain
  type       = "PER_PROJECT_RECORD"
  depends_on = [google_project_service.certificates]
  lifecycle { prevent_destroy = true }
}

# The separate runtime root retains exclusive ownership of services, IAM,
# databases, budgets, secrets, ingestion flags and Scheduler.
data "google_cloud_run_v2_service" "web" {
  count    = var.activate_https ? 1 : 0
  project  = local.project
  location = local.region
  name     = "crm-prod-web"
}

resource "google_certificate_manager_certificate" "crm" {
  count    = var.activate_https ? 1 : 0
  project  = local.project
  location = "global"
  name     = "${local.prefix}-certificate"
  managed {
    domains            = [local.domain]
    dns_authorizations = [google_certificate_manager_dns_authorization.crm.id]
  }
}

resource "google_certificate_manager_certificate_map" "crm" {
  count      = var.activate_https ? 1 : 0
  project    = local.project
  name       = "${local.prefix}-map"
  depends_on = [google_project_service.certificates]
}

resource "google_certificate_manager_certificate_map_entry" "crm" {
  count        = var.activate_https ? 1 : 0
  project      = local.project
  name         = "${local.prefix}-entry"
  map          = google_certificate_manager_certificate_map.crm[0].name
  certificates = [google_certificate_manager_certificate.crm[0].id]
  hostname     = local.domain
}

resource "google_compute_region_network_endpoint_group" "web" {
  count                 = var.activate_https ? 1 : 0
  project               = local.project
  region                = local.region
  name                  = "${local.prefix}-web-neg"
  network_endpoint_type = "SERVERLESS"
  cloud_run { service = data.google_cloud_run_v2_service.web[0].name }
}

resource "google_compute_backend_service" "web" {
  count                 = var.activate_https ? 1 : 0
  project               = local.project
  name                  = "${local.prefix}-web-backend"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  enable_cdn            = false
  backend { group = google_compute_region_network_endpoint_group.web[0].id }
  # Access URL logs are intentionally not enabled: activation links may carry
  # personal single-use tokens. Operational alerting remains in the runtime root.
  log_config { enable = false }
}

resource "google_compute_url_map" "web" {
  count           = var.activate_https ? 1 : 0
  project         = local.project
  name            = "${local.prefix}-https"
  default_service = google_compute_backend_service.web[0].id
}

resource "google_compute_ssl_policy" "web" {
  count           = var.activate_https ? 1 : 0
  project         = local.project
  name            = "${local.prefix}-tls"
  min_tls_version = "TLS_1_2"
  profile         = "MODERN"
}

resource "google_compute_target_https_proxy" "web" {
  count           = var.activate_https ? 1 : 0
  project         = local.project
  name            = "${local.prefix}-proxy"
  url_map         = google_compute_url_map.web[0].id
  ssl_policy      = google_compute_ssl_policy.web[0].id
  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.crm[0].id}"
  depends_on      = [google_certificate_manager_certificate_map_entry.crm]
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = var.activate_https ? 1 : 0
  project               = local.project
  name                  = "${local.prefix}-https"
  ip_address            = google_compute_global_address.web.address
  target                = google_compute_target_https_proxy.web[0].id
  port_range            = "443"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
}

output "dns_records" {
  description = "Exact DNS handoff values; no DNS zone or record is managed by Terraform. Publish the A only after HTTPS/backend qualification."
  value = {
    validation = google_certificate_manager_dns_authorization.crm.dns_resource_record[0]
    crm        = { name = "${local.domain}.", type = "A", data = google_compute_global_address.web.address }
  }
}

output "https_configured" { value = var.activate_https }
