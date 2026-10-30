mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "111111111111"
      // Construct an obviously synthetic value without committing a billing ID.
      billing_account = join("-", ["000000", "000000", "000000"])
    }
  }
  mock_resource "google_cloud_run_v2_service" {
    override_during = plan
    defaults        = { uri = "https://crm-staging-web-actual-ew.a.run.app" }
  }
}
mock_provider "random" {}

variables {
  environment            = "staging"
  billing_account_id     = join("-", ["000000", "000000", "000000"])
  operations_alert_email = "synthetic@example.invalid"
  // Deterministic synthetic pins only; no private payload or native artifact.
  sheet_append_artifact_objects = {
    boundary              = "synthetic-boundary-${sha256("synthetic-boundary")}.json"
    qualification         = "synthetic-qualification-${sha256("synthetic-qualification")}.json"
    allowlist             = "synthetic-allowlist-${sha256("synthetic-allowlist")}.json"
    historical_capability = "synthetic-capability-${sha256("synthetic-historical-capability")}.json"
  }
  sheet_append_artifact_sha256 = {
    boundary              = sha256("synthetic-boundary")
    qualification         = sha256("synthetic-qualification")
    allowlist             = sha256("synthetic-allowlist")
    historical_capability = sha256("synthetic-historical-capability")
  }
  sheet_append_expected_boundary_sha256 = sha256("synthetic-boundary")
}

run "staging_isolated_foundation" {
  command = plan
  assert {
    condition     = output.project_id == "crmynov-stg-n7x4q2" && output.database_name == "crmynov_stg"
    error_message = "STAGING must resolve only to its canonical project/database."
  }
  assert {
    condition     = length(google_cloud_run_v2_service.api) == 0 && length(google_cloud_run_v2_job.runtime) == 0
    error_message = "Foundation preparation must neither open services nor create executable jobs."
  }
}
run "prod_isolated_foundation" {
  command = plan
  variables { environment = "prod" }
  assert {
    condition     = output.project_id == "crmynov-prod-n7x4q2" && output.database_name == "crmynov_prod"
    error_message = "PROD must resolve only to its canonical project/database."
  }
}
run "staging_digest_preview_keeps_ingestion_paused" {
  command = plan
  variables {
    deploy_services = true
    api_image       = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/api@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    web_image       = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/web@sha256:2222222222222222222222222222222222222222222222222222222222222222"
  }
  assert {
    condition     = length(google_cloud_run_v2_job.runtime) == 3 && google_cloud_scheduler_job.follow_up_due[0].paused
    error_message = "Only migrate/grant/due jobs are present and the scheduler must stay paused."
  }
  assert {
    condition     = google_cloud_run_v2_service.api[0].template[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.web[0].template[0].scaling[0].min_instance_count == 0
    error_message = "The pilot must have zero minimum Cloud Run instances."
  }
}
run "reject_dev_target" {
  command = plan
  variables { environment = "dev" }
  expect_failures = [var.environment]
}
run "prod_bounded_api_capacity" {
  command = plan
  variables {
    environment     = "prod"
    deploy_services = true
    api_memory      = "1Gi"
    api_image       = "europe-west1-docker.pkg.dev/crmynov-prod-n7x4q2/crm-ynov-prod/api@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    web_image       = "europe-west1-docker.pkg.dev/crmynov-prod-n7x4q2/crm-ynov-prod/web@sha256:2222222222222222222222222222222222222222222222222222222222222222"
  }
  assert {
    condition     = google_cloud_run_v2_service.api[0].template[0].containers[0].resources[0].limits.memory == "1Gi" && google_cloud_run_v2_service.web[0].template[0].containers[0].resources[0].limits.memory == "512Mi"
    error_message = "Only the API receives the explicit capacity tier."
  }
  assert {
    condition     = google_cloud_run_v2_service.api[0].template[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.api[0].template[0].scaling[0].max_instance_count == 2 && google_cloud_scheduler_job.follow_up_due[0].paused
    error_message = "Capacity does not change instance bounds or activate Scheduler."
  }
}
run "prod_sheet_storage_only_keeps_runtime_off" {
  command = plan
  variables {
    environment                   = "prod"
    sheet_append_storage_prepared = true
  }
  assert {
    condition     = length(google_storage_bucket.sheet_private) == 1 && length(google_cloud_run_v2_job.sheet_append) == 0 && length(google_cloud_scheduler_job.sheet_append) == 0 && length(google_monitoring_alert_policy.sheet_append_failure) == 0
    error_message = "Storage preparation may create only the private store and identities, never executable append runtime."
  }
}
run "prod_sheet_four_artifacts_prepared_stays_off" {
  command = plan
  variables {
    environment                   = "prod"
    deploy_services               = true
    sheet_append_storage_prepared = true
    sheet_append_runtime_prepared = true
    api_image                     = "europe-west1-docker.pkg.dev/crmynov-prod-n7x4q2/crm-ynov-prod/api@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    web_image                     = "europe-west1-docker.pkg.dev/crmynov-prod-n7x4q2/crm-ynov-prod/web@sha256:2222222222222222222222222222222222222222222222222222222222222222"
  }
  assert {
    condition = alltrue([
      for container in [google_cloud_run_v2_service.api[0].template[0].containers[0], google_cloud_run_v2_job.sheet_append[0].template[0].template[0].containers[0]] :
      one([for e in container.env : e.value if e.name == "CRM_SHEET_HISTORICAL_CAPABILITY_FILE"]) == "/var/run/crm-sheet-private/${var.sheet_append_artifact_objects.historical_capability}"
      && one([for e in container.env : e.value if e.name == "CRM_SHEET_HISTORICAL_CAPABILITY_SHA256"]) == var.sheet_append_artifact_sha256.historical_capability
    ])
    error_message = "Both the API and isolated worker must receive the same fourth private capability path and SHA."
  }
  assert {
    condition = alltrue([
      for container in [google_cloud_run_v2_service.api[0].template[0].containers[0], google_cloud_run_v2_job.sheet_append[0].template[0].template[0].containers[0]] :
      length([for e in container.env : e.name if contains(["FORMINATOR_WEBHOOK_ENABLED", "SHEETS_ENABLED", "SHEET_CUTOVER_ENABLED", "CRM_GOOGLE_SHEETS_ENABLED", "SHEET_ROW_APPEND_ENABLED", "CRM_SHEET_APPEND_POLICY_QUALIFIED"], e.name)]) == 6
      && alltrue([for e in container.env : e.value == "false" if contains(["FORMINATOR_WEBHOOK_ENABLED", "SHEETS_ENABLED", "SHEET_CUTOVER_ENABLED", "CRM_GOOGLE_SHEETS_ENABLED", "SHEET_ROW_APPEND_ENABLED", "CRM_SHEET_APPEND_POLICY_QUALIFIED"], e.name)])
    ])
    error_message = "Mounting four artifacts must leave all six ingestion flags OFF in both consumers."
  }
  assert {
    condition     = google_cloud_run_v2_service.api[0].template[0].volumes[0].gcs[0].read_only && google_cloud_run_v2_job.sheet_append[0].template[0].template[0].volumes[0].gcs[0].read_only
    error_message = "The existing shared private mount remains read-only in API and worker."
  }
  assert {
    condition     = google_cloud_scheduler_job.sheet_append[0].paused && google_cloud_run_v2_job.sheet_append[0].template[0].template[0].max_retries == 0 && google_cloud_run_v2_job.sheet_append[0].template[0].template[0].timeout == "300s"
    error_message = "Preparation must keep the append Scheduler PAUSED and preserve the bounded worker retry/timeout settings."
  }
  assert {
    condition     = length(google_monitoring_alert_policy.sheet_append_failure) == 1 && google_monitoring_alert_policy.sheet_append_failure[0].conditions[0].condition_matched_log[0].filter == "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"crm-prod-sheet-append\" AND (severity>=ERROR OR (jsonPayload.job=\"sheet-append\" AND jsonPayload.completed=false))"
    error_message = "Only the append job has the additional matched-log policy, including completed:false stdout summaries."
  }
}
run "reject_sheet_runtime_missing_capability_object" {
  command = plan
  variables {
    deploy_services               = true
    sheet_append_storage_prepared = true
    sheet_append_runtime_prepared = true
    api_image                     = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/api@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    web_image                     = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/web@sha256:2222222222222222222222222222222222222222222222222222222222222222"
    sheet_append_artifact_objects = {
      boundary      = "synthetic-boundary-${sha256("synthetic-boundary")}.json"
      qualification = "synthetic-qualification-${sha256("synthetic-qualification")}.json"
      allowlist     = "synthetic-allowlist-${sha256("synthetic-allowlist")}.json"
    }
  }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_sheet_runtime_missing_capability_sha" {
  command = plan
  variables {
    deploy_services               = true
    sheet_append_storage_prepared = true
    sheet_append_runtime_prepared = true
    api_image                     = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/api@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    web_image                     = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/web@sha256:2222222222222222222222222222222222222222222222222222222222222222"
    sheet_append_artifact_sha256 = {
      boundary      = sha256("synthetic-boundary")
      qualification = sha256("synthetic-qualification")
      allowlist     = sha256("synthetic-allowlist")
    }
  }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_sheet_runtime_extra_artifact" {
  command = plan
  variables {
    deploy_services               = true
    sheet_append_storage_prepared = true
    sheet_append_runtime_prepared = true
    api_image                     = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/api@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    web_image                     = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/web@sha256:2222222222222222222222222222222222222222222222222222222222222222"
    sheet_append_artifact_objects = {
      boundary              = "synthetic-boundary-${sha256("synthetic-boundary")}.json"
      qualification         = "synthetic-qualification-${sha256("synthetic-qualification")}.json"
      allowlist             = "synthetic-allowlist-${sha256("synthetic-allowlist")}.json"
      historical_capability = "synthetic-capability-${sha256("synthetic-historical-capability")}.json"
      unexpected            = "synthetic-extra-${sha256("synthetic-extra")}.json"
    }
  }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_sheet_runtime_capability_name_hash_mismatch" {
  command = plan
  variables {
    deploy_services               = true
    sheet_append_storage_prepared = true
    sheet_append_runtime_prepared = true
    api_image                     = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/api@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    web_image                     = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/web@sha256:2222222222222222222222222222222222222222222222222222222222222222"
    sheet_append_artifact_objects = {
      boundary              = "synthetic-boundary-${sha256("synthetic-boundary")}.json"
      qualification         = "synthetic-qualification-${sha256("synthetic-qualification")}.json"
      allowlist             = "synthetic-allowlist-${sha256("synthetic-allowlist")}.json"
      historical_capability = "synthetic-capability-${sha256("wrong-synthetic-capability")}.json"
    }
  }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_sheet_capability_traversal" {
  command = plan
  variables {
    sheet_append_artifact_objects = { historical_capability = "../capability.json" }
  }
  expect_failures = [var.sheet_append_artifact_objects]
}
run "reject_sheet_capability_malformed_digest" {
  command = plan
  variables {
    sheet_append_artifact_sha256 = { historical_capability = "not-a-sha256" }
  }
  expect_failures = [var.sheet_append_artifact_sha256]
}
run "reject_sheet_runtime_before_storage" {
  command = plan
  variables { sheet_append_runtime_prepared = true }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_sheet_activation_before_runtime" {
  command = plan
  variables { sheet_append_enabled = true }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_sheet_scheduler_before_observation" {
  command = plan
  variables { sheet_append_scheduler_paused = false }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_unreviewed_api_capacity" {
  command = plan
  variables { api_memory = "2Gi" }
  expect_failures = [var.api_memory]
}
run "reject_mutable_image" {
  command = plan
  variables { api_image = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/api:latest" }
  expect_failures = [var.api_image]
}
run "reject_cross_environment_digest" {
  command = plan
  variables { api_image = "europe-west1-docker.pkg.dev/crmynov-dev-n7x4q2/crm-ynov-dev/api@sha256:1111111111111111111111111111111111111111111111111111111111111111" }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_open_without_images" {
  command = plan
  variables { deploy_services = true }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_recovery_without_qualified_mail" {
  command = plan
  variables { access_recovery_enabled = true }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_cross_environment_origin" {
  command = plan
  variables { crm_public_origin = "https://crm-prod-web-synthetic-ew.a.run.app" }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_unmatched_native_origin" {
  command = plan
  variables {
    deploy_services   = true
    api_image         = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/api@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    web_image         = "europe-west1-docker.pkg.dev/crmynov-stg-n7x4q2/crm-ynov-staging/web@sha256:2222222222222222222222222222222222222222222222222222222222222222"
    crm_public_origin = "https://crm-staging-web-wrong-ew.a.run.app"
  }
  expect_failures = [google_cloud_run_v2_service.web]
}
run "reject_latest_secret_version" {
  command = plan
  variables { gmail_secret_versions = { client_id = "latest" } }
  expect_failures = [var.gmail_secret_versions]
}
run "reject_foreign_deployer" {
  command = plan
  variables { deployer_service_account_email = "gh-deploy-dev@crmynov-dev-n7x4q2.iam.gserviceaccount.com" }
  expect_failures = [google_sql_database_instance.postgres]
}
run "reject_wrong_billing_association" {
  command = plan
  variables { billing_account_id = join("-", ["111111", "111111", "111111"]) }
  expect_failures = [google_sql_database_instance.postgres]
}
