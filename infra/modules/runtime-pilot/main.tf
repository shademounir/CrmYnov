locals {
  targets = {
    staging = { project_id = "crmynov-stg-n7x4q2", database = "crmynov_stg", cidr = "10.43.0.0/24" }
    prod    = { project_id = "crmynov-prod-n7x4q2", database = "crmynov_prod", cidr = "10.44.0.0/24" }
  }
  target      = local.targets[var.environment]
  project_id  = local.target.project_id
  region      = "europe-west1"
  prefix      = "crm-${var.environment}"
  repository  = "crm-ynov-${var.environment}"
  registry    = "${local.region}-docker.pkg.dev/${local.project_id}/${local.repository}"
  job_image   = var.job_image != "" ? var.job_image : var.api_image
  deploy_jobs = local.job_image != ""
  labels      = { application = "crm-ynov", environment = var.environment, managed-by = "terraform" }
  services = toset(concat([
    "artifactregistry.googleapis.com", "billingbudgets.googleapis.com", "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "run.googleapis.com",
    "secretmanager.googleapis.com", "servicenetworking.googleapis.com", "serviceusage.googleapis.com",
    "sqladmin.googleapis.com", "cloudscheduler.googleapis.com", "monitoring.googleapis.com",
  ], var.gmail_invitation_enabled ? ["gmail.googleapis.com"] : []))
  // No Sheets worker/source/API or inbound/audio connector is provisioned.
  disabled_ingestion = {
    FORMINATOR_WEBHOOK_ENABLED        = "false"
    SHEETS_ENABLED                    = "false"
    SHEET_CUTOVER_ENABLED             = "false"
    CRM_GOOGLE_SHEETS_ENABLED         = "false"
    SHEET_ROW_APPEND_ENABLED          = "false"
    CRM_SHEET_APPEND_POLICY_QUALIFIED = "false"
  }
  gmail_secrets = { client_id = "gmail-oauth-client-id", client_secret = "gmail-oauth-client-secret", refresh_token = "gmail-oauth-refresh-token" }
  accounts      = toset(["api", "web", "jobs", "migrator", "scheduler"])
  jobs = local.deploy_jobs ? {
    migrate = { suffix = "migrate", account = "migrator", timeout = "900s", retries = 0, args = ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema=apps/api/prisma/schema.prisma"] }
    grant   = { suffix = "grant-runtime-database", account = "migrator", timeout = "300s", retries = 0, args = ["apps/api/dist/jobs/grant-runtime-database.js"] }
    due     = { suffix = "follow-up-due", account = "jobs", timeout = "120s", retries = 1, args = ["apps/api/dist/jobs/follow-up-due.js"] }
  } : {}
}

// Project/billing ownership belongs to the separately reviewed metadata bootstrap.
data "google_project" "current" { project_id = local.project_id }

resource "google_project_service" "runtime" {
  for_each           = local.services
  project            = local.project_id
  service            = each.value
  disable_on_destroy = false
}
resource "google_artifact_registry_repository" "containers" {
  project       = local.project_id
  location      = local.region
  repository_id = local.repository
  format        = "DOCKER"
  labels        = local.labels
  description   = "Immutable CRM ${var.environment} pilot images"
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.runtime]
}
resource "google_compute_network" "runtime" {
  project                 = local.project_id
  name                    = "crm-ynov-${var.environment}"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.runtime]
}
resource "google_compute_subnetwork" "run" {
  project                  = local.project_id
  name                     = "crm-ynov-${var.environment}-run-ew1"
  region                   = local.region
  network                  = google_compute_network.runtime.id
  ip_cidr_range            = local.target.cidr
  private_ip_google_access = true
}
resource "google_compute_global_address" "service_range" {
  project       = local.project_id
  name          = "crm-ynov-${var.environment}-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.runtime.id
}
resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.runtime.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.service_range.name]
}
resource "random_password" "database" {
  for_each         = toset(["runtime", "migrator"])
  length           = 32
  special          = true
  override_special = "-_"
}
resource "random_bytes" "telephony_encryption" { length = 32 }

resource "google_sql_database_instance" "postgres" {
  project             = local.project_id
  name                = "crm-ynov-${var.environment}-pg17"
  region              = local.region
  database_version    = "POSTGRES_17"
  deletion_protection = true
  settings {
    edition                     = "ENTERPRISE"
    tier                        = "db-f1-micro"
    availability_type           = "ZONAL"
    deletion_protection_enabled = true
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    disk_autoresize             = true
    user_labels                 = local.labels
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "02:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.runtime.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }
    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = false
      record_client_address   = false
    }
  }
  lifecycle {
    prevent_destroy = true
    precondition {
      condition = alltrue([
        var.api_image == "" || startswith(var.api_image, "${local.registry}/api@sha256:"),
        var.web_image == "" || startswith(var.web_image, "${local.registry}/web@sha256:"),
        var.job_image == "" || startswith(var.job_image, "${local.registry}/api@sha256:"),
      ])
      error_message = "Promote qualified identical digests into this target registry; cross-environment image references are forbidden."
    }
    precondition {
      condition     = !var.deploy_services || (var.api_image != "" && var.web_image != "")
      error_message = "Opening services requires compatible immutable images."
    }
    precondition {
      condition     = !var.access_recovery_enabled || (var.gmail_invitation_enabled && var.crm_public_origin != "")
      error_message = "Recovery requires a separately qualified target Gmail transport and exact reviewed origin."
    }
    precondition {
      condition     = var.crm_public_origin == "" || startswith(var.crm_public_origin, "https://${local.prefix}-web-")
      error_message = "Until separately reviewed domain routing is implemented, the origin must be the native Web URI of this target, never another environment."
    }
    precondition {
      condition     = data.google_project.current.billing_account == var.billing_account_id
      error_message = "The canonical project must be linked to the separately authorized billing account before runtime provisioning."
    }
    precondition {
      condition     = !var.gmail_invitation_enabled || (var.gmail_sender_email != "" && var.crm_public_origin != "" && toset(keys(var.gmail_secret_versions)) == toset(keys(local.gmail_secrets)))
      error_message = "Gmail requires separate target qualification, authorized sender/origin and three pinned existing versions."
    }
    precondition {
      condition     = var.deployer_service_account_email == "" || var.deployer_service_account_email == "gh-deploy-${var.environment}@${local.project_id}.iam.gserviceaccount.com"
      error_message = "Only the existing canonical target deploy identity can receive these bounded bindings."
    }
  }
  depends_on = [google_service_networking_connection.private_services, google_project_service.runtime]
}
resource "google_sql_database" "crm" {
  project  = local.project_id
  name     = local.target.database
  instance = google_sql_database_instance.postgres.name
  lifecycle { prevent_destroy = true }
}
resource "google_sql_user" "database" {
  for_each = { runtime = "crm_runtime", migrator = "crm_migrator" }
  project  = local.project_id
  instance = google_sql_database_instance.postgres.name
  name     = each.value
  password = random_password.database[each.key].result
}
resource "google_service_account" "runtime" {
  for_each     = local.accounts
  project      = local.project_id
  account_id   = "${local.prefix}-${each.value}"
  display_name = "CRM ${var.environment} ${each.value}"
  depends_on   = [google_project_service.runtime]
}
resource "google_secret_manager_secret" "database" {
  for_each  = toset(["runtime", "migrator"])
  project   = local.project_id
  secret_id = "${local.prefix}-${each.key}-database-url"
  labels    = local.labels
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.runtime]
}
resource "google_secret_manager_secret_version" "database" {
  for_each    = toset(["runtime", "migrator"])
  secret      = google_secret_manager_secret.database[each.key].id
  secret_data = "postgresql://${google_sql_user.database[each.key].name}:${urlencode(random_password.database[each.key].result)}@${google_sql_database_instance.postgres.private_ip_address}:5432/${google_sql_database.crm.name}?sslmode=require&connection_limit=${each.key == "runtime" ? 5 : 2}"
}
resource "google_secret_manager_secret" "telephony" {
  project   = local.project_id
  secret_id = "${local.prefix}-telephony-command-key"
  labels    = local.labels
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.runtime]
}
resource "google_secret_manager_secret_version" "telephony" {
  secret      = google_secret_manager_secret.telephony.id
  secret_data = random_bytes.telephony_encryption.base64
}
resource "google_secret_manager_secret" "gmail" {
  for_each  = local.gmail_secrets
  project   = local.project_id
  secret_id = "${local.prefix}-${each.value}"
  labels    = local.labels
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.runtime]
}
resource "google_secret_manager_secret_iam_member" "runtime_database" {
  for_each  = toset(["api", "jobs"])
  project   = local.project_id
  secret_id = google_secret_manager_secret.database["runtime"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime[each.key].member
}
resource "google_secret_manager_secret_iam_member" "migration_database" {
  project   = local.project_id
  secret_id = google_secret_manager_secret.database["migrator"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime["migrator"].member
}
resource "google_secret_manager_secret_iam_member" "api_secrets" {
  for_each = merge({ telephony = google_secret_manager_secret.telephony.secret_id }, var.gmail_invitation_enabled ? {
    for key, secret in google_secret_manager_secret.gmail : key => secret.secret_id
  } : {})
  project   = local.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime["api"].member
}
resource "google_project_iam_member" "cloudsql" {
  for_each = toset(["api", "jobs", "migrator"])
  project  = local.project_id
  role     = "roles/cloudsql.client"
  member   = google_service_account.runtime[each.key].member
}
resource "google_project_iam_member" "deploy_roles" {
  for_each = var.deployer_service_account_email == "" ? toset([]) : toset(["roles/artifactregistry.writer", "roles/cloudsql.viewer", "roles/run.admin", "roles/secretmanager.viewer", "roles/serviceusage.serviceUsageViewer"])
  project  = local.project_id
  role     = each.key
  member   = "serviceAccount:${var.deployer_service_account_email}"
}
resource "google_service_account_iam_member" "deploy_act_as" {
  for_each           = var.deployer_service_account_email == "" ? toset([]) : local.accounts
  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deployer_service_account_email}"
}

resource "google_cloud_run_v2_service" "api" {
  count               = var.deploy_services ? 1 : 0
  project             = local.project_id
  name                = "${local.prefix}-api"
  location            = local.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true
  labels              = local.labels
  template {
    service_account                  = google_service_account.runtime["api"].email
    timeout                          = "60s"
    max_instance_request_concurrency = 40
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.runtime.id
        subnetwork = google_compute_subnetwork.run.id
      }
    }
    containers {
      image = var.api_image
      ports { container_port = 3001 }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      dynamic "env" {
        for_each = merge(local.disabled_ingestion, { API_PORT = "3001", LOG_LEVEL = "warn", CRM_BACKGROUND_WORKERS = "external", CRM_ACCESS_RECOVERY_ENABLED = tostring(var.access_recovery_enabled), CRM_PUBLIC_ORIGIN = var.crm_public_origin })
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database["runtime"].secret_id
            version = google_secret_manager_secret_version.database["runtime"].version
          }
        }
      }
      env {
        name = "TELEPHONY_COMMAND_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.telephony.secret_id
            version = google_secret_manager_secret_version.telephony.version
          }
        }
      }
      dynamic "env" {
        for_each = var.gmail_invitation_enabled ? { GMAIL_OAUTH_CLIENT_ID = "client_id", GMAIL_OAUTH_CLIENT_SECRET = "client_secret", GMAIL_OAUTH_REFRESH_TOKEN = "refresh_token" } : {}
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.gmail[env.value].secret_id
              version = var.gmail_secret_versions[env.value]
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.gmail_invitation_enabled ? toset(["sender"]) : toset([])
        content {
          name  = "GMAIL_SENDER_EMAIL"
          value = var.gmail_sender_email
        }
      }
      startup_probe {
        initial_delay_seconds = 2
        timeout_seconds       = 2
        period_seconds        = 3
        failure_threshold     = 20
        http_get {
          path = "/health/ready"
          port = 3001
        }
      }
      liveness_probe {
        timeout_seconds   = 2
        period_seconds    = 15
        failure_threshold = 3
        http_get {
          path = "/health"
          port = 3001
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.runtime_database, google_secret_manager_secret_iam_member.api_secrets]
}
resource "google_cloud_run_v2_service_iam_member" "web_invokes_api" {
  count    = var.deploy_services ? 1 : 0
  project  = local.project_id
  location = local.region
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = google_service_account.runtime["web"].member
}
resource "google_cloud_run_v2_service" "web" {
  count               = var.deploy_services ? 1 : 0
  project             = local.project_id
  name                = "${local.prefix}-web"
  location            = local.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true
  labels              = local.labels
  lifecycle {
    postcondition {
      condition     = var.crm_public_origin == "" || var.crm_public_origin == self.uri
      error_message = "The pinned origin must match this actual target Web URI. Custom domains require a separate reviewed routing change."
    }
  }
  template {
    service_account                  = google_service_account.runtime["web"].email
    timeout                          = "60s"
    max_instance_request_concurrency = 40
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image = var.web_image
      ports { container_port = 3000 }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      dynamic "env" {
        for_each = { HOSTNAME = "0.0.0.0", CRM_API_INTERNAL_URL = google_cloud_run_v2_service.api[0].uri, CRM_API_USE_IAM = "true", CRM_PUBLIC_ORIGIN = var.crm_public_origin }
        content {
          name  = env.key
          value = env.value
        }
      }
      startup_probe {
        initial_delay_seconds = 1
        timeout_seconds       = 2
        period_seconds        = 3
        failure_threshold     = 20
        http_get {
          path = "/api/health"
          port = 3000
        }
      }
      liveness_probe {
        timeout_seconds   = 2
        period_seconds    = 15
        failure_threshold = 3
        http_get {
          path = "/api/health"
          port = 3000
        }
      }
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.web_invokes_api]
}
resource "google_cloud_run_v2_service_iam_member" "public_web" {
  count    = var.deploy_services ? 1 : 0
  project  = local.project_id
  location = local.region
  name     = google_cloud_run_v2_service.web[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_job" "runtime" {
  for_each            = local.jobs
  project             = local.project_id
  name                = "${local.prefix}-${each.value.suffix}"
  location            = local.region
  deletion_protection = true
  labels              = local.labels
  template {
    template {
      service_account = google_service_account.runtime[each.value.account].email
      timeout         = each.value.timeout
      max_retries     = each.value.retries
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.runtime.id
          subnetwork = google_compute_subnetwork.run.id
        }
      }
      containers {
        image = local.job_image
        args  = each.value.args
        resources { limits = { cpu = "1", memory = "512Mi" } }
        dynamic "env" {
          for_each = merge(local.disabled_ingestion, { CRM_BACKGROUND_WORKERS = "external" }, each.key == "grant" ? {
            CRM_RUNTIME_DATABASE_ROLE = "crm_runtime", CRM_RUNTIME_DATABASE_NAME = local.target.database, CRM_RUNTIME_DATABASE_ENVIRONMENT = var.environment, CRM_RUNTIME_DATABASE_PROJECT = local.project_id
          } : {})
          content {
            name  = env.key
            value = env.value
          }
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database[each.value.account == "migrator" ? "migrator" : "runtime"].secret_id
              version = google_secret_manager_secret_version.database[each.value.account == "migrator" ? "migrator" : "runtime"].version
            }
          }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.runtime_database, google_secret_manager_secret_iam_member.migration_database, google_project_iam_member.cloudsql]
}
resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_due" {
  count    = local.deploy_jobs ? 1 : 0
  project  = local.project_id
  location = local.region
  name     = google_cloud_run_v2_job.runtime["due"].name
  role     = "roles/run.invoker"
  member   = google_service_account.runtime["scheduler"].member
}
resource "google_cloud_scheduler_job" "follow_up_due" {
  count     = local.deploy_jobs ? 1 : 0
  project   = local.project_id
  region    = local.region
  name      = "${local.prefix}-follow-up-due"
  schedule  = "* * * * *"
  time_zone = "Etc/UTC"
  paused    = true
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${local.project_id}/locations/${local.region}/jobs/${google_cloud_run_v2_job.runtime["due"].name}:run"
    oauth_token { service_account_email = google_service_account.runtime["scheduler"].email }
  }
  retry_config {
    retry_count          = 2
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_retry_duration   = "120s"
  }
  depends_on = [google_cloud_run_v2_job_iam_member.scheduler_runs_due]
}
