locals {
  deploy_images   = var.api_image != "" && var.web_image != ""
  job_image       = var.job_image != "" ? var.job_image : var.api_image
  deploy_jobs     = local.job_image != ""
  deploy_services = local.deploy_images && var.deploy_services
  labels = {
    application = "crm-ynov"
    environment = "dev"
    managed-by  = "terraform"
  }
  services = toset([
    "artifactregistry.googleapis.com", "compute.googleapis.com", "iamcredentials.googleapis.com",
    "run.googleapis.com", "secretmanager.googleapis.com", "servicenetworking.googleapis.com",
    "serviceusage.googleapis.com", "sqladmin.googleapis.com", "cloudscheduler.googleapis.com",
  ])
}

data "google_project" "current" { project_id = var.project_id }

resource "google_project_service" "runtime" {
  for_each           = local.services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = "crm-ynov-dev"
  description   = "Immutable CRM Ynov DEV container images"
  format        = "DOCKER"
  labels        = local.labels
  depends_on    = [google_project_service.runtime]
}

resource "google_compute_network" "dev" {
  project                 = var.project_id
  name                    = "crm-ynov-dev"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.runtime]
}
resource "google_compute_subnetwork" "run" {
  project                  = var.project_id
  name                     = "crm-ynov-dev-run-ew1"
  region                   = var.region
  network                  = google_compute_network.dev.id
  ip_cidr_range            = "10.42.0.0/24"
  private_ip_google_access = true
}
resource "google_compute_global_address" "service_range" {
  project       = var.project_id
  name          = "crm-ynov-dev-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.dev.id
}
resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.dev.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.service_range.name]
}

resource "random_password" "runtime_database" {
  length           = 32
  special          = true
  override_special = "-_"
}
resource "random_password" "migration_database" {
  length           = 32
  special          = true
  override_special = "-_"
}
resource "random_bytes" "telephony_encryption" { length = 32 }
resource "random_password" "synthetic_login" {
  length           = 24
  special          = true
  override_special = "-_!"
}

resource "google_sql_database_instance" "postgres" {
  project             = var.project_id
  name                = "crm-ynov-dev-pg17"
  region              = var.region
  database_version    = "POSTGRES_17"
  deletion_protection = true
  settings {
    edition           = "ENTERPRISE"
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true
    user_labels       = local.labels
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
      private_network = google_compute_network.dev.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }
    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = false
      record_client_address   = false
    }
  }
  depends_on = [google_service_networking_connection.private_services, google_project_service.runtime]
  lifecycle { prevent_destroy = true }
}
resource "google_sql_database" "crm" {
  project  = var.project_id
  name     = "crmynov_dev"
  instance = google_sql_database_instance.postgres.name
}
resource "google_sql_user" "runtime" {
  project  = var.project_id
  name     = "crm_runtime"
  instance = google_sql_database_instance.postgres.name
  password = random_password.runtime_database.result
}
resource "google_sql_user" "migrator" {
  project  = var.project_id
  name     = "crm_migrator"
  instance = google_sql_database_instance.postgres.name
  password = random_password.migration_database.result
}

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "crm-dev-api"
  display_name = "CRM DEV API runtime"
}
resource "google_service_account" "web" {
  project      = var.project_id
  account_id   = "crm-dev-web"
  display_name = "CRM DEV Web BFF"
}
resource "google_service_account" "jobs" {
  project      = var.project_id
  account_id   = "crm-dev-jobs"
  display_name = "CRM DEV migrations and due jobs"
}
resource "google_service_account" "scheduler" {
  project      = var.project_id
  account_id   = "crm-dev-scheduler"
  display_name = "CRM DEV scheduler invoker"
}
resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = "gh-deploy-dev"
  display_name = "CRM DEV keyless deployer"
  description  = "Impersonated only through the existing Bootstrap WIF provider."
}

resource "google_secret_manager_secret" "database_url" {
  project   = var.project_id
  secret_id = "crm-dev-database-url"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.runtime]
}
resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://${google_sql_user.runtime.name}:${urlencode(random_password.runtime_database.result)}@localhost/${google_sql_database.crm.name}?host=${urlencode("/cloudsql/${google_sql_database_instance.postgres.connection_name}")}&connection_limit=5"
}
resource "google_secret_manager_secret_version" "database_url_private" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://${google_sql_user.runtime.name}:${urlencode(random_password.runtime_database.result)}@${google_sql_database_instance.postgres.private_ip_address}:5432/${google_sql_database.crm.name}?sslmode=require&connection_limit=5"
  depends_on  = [google_secret_manager_secret_version.database_url]
}
resource "google_secret_manager_secret" "migration_database_url" {
  project   = var.project_id
  secret_id = "crm-dev-migration-database-url"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.runtime]
}
resource "google_secret_manager_secret_version" "migration_database_url" {
  secret      = google_secret_manager_secret.migration_database_url.id
  secret_data = "postgresql://${google_sql_user.migrator.name}:${urlencode(random_password.migration_database.result)}@localhost/${google_sql_database.crm.name}?host=${urlencode("/cloudsql/${google_sql_database_instance.postgres.connection_name}")}&connection_limit=2"
}
resource "google_secret_manager_secret_version" "migration_database_url_private" {
  secret      = google_secret_manager_secret.migration_database_url.id
  secret_data = "postgresql://${google_sql_user.migrator.name}:${urlencode(random_password.migration_database.result)}@${google_sql_database_instance.postgres.private_ip_address}:5432/${google_sql_database.crm.name}?sslmode=require&connection_limit=2"
  depends_on  = [google_secret_manager_secret_version.migration_database_url]
}
resource "google_secret_manager_secret" "telephony_encryption" {
  project   = var.project_id
  secret_id = "crm-dev-telephony-command-key"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.runtime]
}
resource "google_secret_manager_secret_version" "telephony_encryption" {
  secret      = google_secret_manager_secret.telephony_encryption.id
  secret_data = random_bytes.telephony_encryption.base64
}
resource "google_secret_manager_secret" "synthetic_login" {
  project   = var.project_id
  secret_id = "crm-dev-synthetic-login-password"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.runtime]
}
resource "google_secret_manager_secret_version" "synthetic_login" {
  secret      = google_secret_manager_secret.synthetic_login.id
  secret_data = random_password.synthetic_login.result
}

locals {
  database_secret_members = toset([google_service_account.api.member, google_service_account.jobs.member])
}
resource "google_secret_manager_secret_iam_member" "database" {
  for_each  = local.database_secret_members
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value
}
resource "google_secret_manager_secret_iam_member" "migration_database" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.migration_database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.jobs.member
}
resource "google_secret_manager_secret_iam_member" "telephony" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.telephony_encryption.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.api.member
}
resource "google_secret_manager_secret_iam_member" "synthetic_login" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.synthetic_login.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.jobs.member
}
resource "google_project_iam_member" "cloudsql" {
  for_each = toset([google_service_account.api.member, google_service_account.jobs.member])
  project  = var.project_id
  role     = "roles/cloudsql.client"
  member   = each.value
}
resource "google_project_iam_member" "deploy_roles" {
  for_each = toset(["roles/artifactregistry.writer", "roles/cloudsql.viewer", "roles/run.admin", "roles/secretmanager.viewer", "roles/serviceusage.serviceUsageViewer"])
  project  = var.project_id
  role     = each.value
  member   = google_service_account.deploy.member
}
resource "google_service_account_iam_member" "deploy_act_as" {
  for_each           = { api = google_service_account.api.name, web = google_service_account.web.name, jobs = google_service_account.jobs.name, scheduler = google_service_account.scheduler.name }
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deploy.member
}
resource "google_service_account_iam_member" "wif_deploy" {
  count              = var.wif_deploy_principal == "" ? 0 : 1
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = var.wif_deploy_principal
}

resource "google_cloud_run_v2_service" "api" {
  count               = local.deploy_services ? 1 : 0
  project             = var.project_id
  name                = "crm-dev-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.labels
  deletion_protection = true
  template {
    service_account                  = google_service_account.api.email
    timeout                          = "60s"
    max_instance_request_concurrency = 40
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.dev.id
        subnetwork = google_compute_subnetwork.run.id
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }
    containers {
      image = var.api_image
      ports { container_port = 3001 }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      env {
        name  = "API_PORT"
        value = "3001"
      }
      env {
        name  = "LOG_LEVEL"
        value = "warn"
      }
      env {
        name  = "CRM_BACKGROUND_WORKERS"
        value = "external"
      }
      env {
        name  = "FORMINATOR_WEBHOOK_ENABLED"
        value = "false"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "TELEPHONY_COMMAND_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.telephony_encryption.secret_id
            version = "latest"
          }
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
  depends_on = [google_secret_manager_secret_iam_member.database, google_secret_manager_secret_iam_member.telephony]
}
resource "google_cloud_run_v2_service_iam_member" "web_invokes_api" {
  count    = local.deploy_services ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = google_service_account.web.member
}
resource "google_cloud_run_v2_service" "web" {
  count               = local.deploy_services ? 1 : 0
  project             = var.project_id
  name                = "crm-dev-web"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.labels
  deletion_protection = true
  template {
    service_account                  = google_service_account.web.email
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
      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name  = "HOSTNAME"
        value = "0.0.0.0"
      }
      env {
        name  = "CRM_API_INTERNAL_URL"
        value = google_cloud_run_v2_service.api[0].uri
      }
      env {
        name  = "CRM_API_USE_IAM"
        value = "true"
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
  count    = local.deploy_services ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.web[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_job" "migrate" {
  count               = local.deploy_jobs ? 1 : 0
  project             = var.project_id
  name                = "crm-dev-migrate"
  location            = var.region
  labels              = local.labels
  deletion_protection = true
  template {
    template {
      service_account = google_service_account.jobs.email
      timeout         = "900s"
      max_retries     = 0
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.dev.id
          subnetwork = google_compute_subnetwork.run.id
        }
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }
      containers {
        image = local.job_image
        args  = ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema=apps/api/prisma/schema.prisma"]
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.migration_database_url.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
}
resource "google_cloud_run_v2_job" "grant_runtime_database" {
  count               = local.deploy_jobs ? 1 : 0
  project             = var.project_id
  name                = "crm-dev-grant-runtime-database"
  location            = var.region
  labels              = local.labels
  deletion_protection = true
  template {
    template {
      service_account = google_service_account.jobs.email
      timeout         = "300s"
      max_retries     = 0
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.dev.id
          subnetwork = google_compute_subnetwork.run.id
        }
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }
      containers {
        image = local.job_image
        args  = ["apps/api/dist/jobs/grant-runtime-database.js"]
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name  = "CRM_RUNTIME_DATABASE_ROLE"
          value = google_sql_user.runtime.name
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.migration_database_url.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_cloud_run_v2_job.migrate]
}
resource "google_cloud_run_v2_job" "seed_synthetic" {
  count               = local.deploy_jobs ? 1 : 0
  project             = var.project_id
  name                = "crm-dev-seed-synthetic"
  location            = var.region
  labels              = local.labels
  deletion_protection = true
  template {
    template {
      service_account = google_service_account.jobs.email
      timeout         = "300s"
      max_retries     = 0
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.dev.id
          subnetwork = google_compute_subnetwork.run.id
        }
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }
      containers {
        image = local.job_image
        args  = ["apps/api/dist-local/prisma/seed-local.js"]
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "CRM_LOCAL_SEED_PASSWORD"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.synthetic_login.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_cloud_run_v2_job.grant_runtime_database]
}
resource "google_cloud_run_v2_job" "follow_up_due" {
  count               = local.deploy_jobs ? 1 : 0
  project             = var.project_id
  name                = "crm-dev-follow-up-due"
  location            = var.region
  labels              = local.labels
  deletion_protection = true
  template {
    template {
      service_account = google_service_account.jobs.email
      timeout         = "120s"
      max_retries     = 1
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.dev.id
          subnetwork = google_compute_subnetwork.run.id
        }
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }
      containers {
        image = local.job_image
        args  = ["apps/api/dist/jobs/follow-up-due.js"]
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name  = "CRM_BACKGROUND_WORKERS"
          value = "external"
        }
        env {
          name  = "FORMINATOR_WEBHOOK_ENABLED"
          value = "false"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
}
resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_due" {
  count    = local.deploy_jobs ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.follow_up_due[0].name
  role     = "roles/run.invoker"
  member   = google_service_account.scheduler.member
}
resource "google_cloud_scheduler_job" "follow_up_due" {
  count       = local.deploy_jobs ? 1 : 0
  project     = var.project_id
  region      = var.region
  name        = "crm-dev-follow-up-due"
  description = "Runs the idempotent PostgreSQL due transition outside request CPU."
  schedule    = "* * * * *"
  time_zone   = "Etc/UTC"
  paused      = var.scheduler_paused
  retry_config {
    retry_count          = 2
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_retry_duration   = "120s"
  }
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.follow_up_due[0].name}:run"
    oauth_token { service_account_email = google_service_account.scheduler.email }
  }
  depends_on = [google_cloud_run_v2_job_iam_member.scheduler_runs_due]
}

resource "google_billing_budget" "dev" {
  count           = var.manage_budget ? 1 : 0
  billing_account = var.billing_account_id
  display_name    = "CRM Ynov DEV runtime monthly alert"
  budget_filter { projects = ["projects/${data.google_project.current.number}"] }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(floor(var.budget_amount_usd))
    }
  }
  dynamic "threshold_rules" {
    for_each = toset([0.5, 0.8, 1.0])
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }
  all_updates_rule {
    monitoring_notification_channels = var.budget_notification_channels
    disable_default_iam_recipients   = false
  }
  lifecycle {
    precondition {
      condition     = var.billing_account_id != ""
      error_message = "billing_account_id is required when manage_budget is true."
    }
  }
}
