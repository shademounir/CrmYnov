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
