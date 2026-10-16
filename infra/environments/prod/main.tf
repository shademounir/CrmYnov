locals {
  project_id = "crmynov-prod-n7x4q2"
  region     = "europe-west1"
}
provider "google" {
  project = local.project_id
  region  = local.region
}
module "runtime" {
  source                                = "../../modules/runtime-pilot"
  environment                           = "prod"
  billing_account_id                    = var.billing_account_id
  operations_alert_email                = var.operations_alert_email
  api_image                             = var.api_image
  api_memory                            = "1Gi"
  web_image                             = var.web_image
  job_image                             = var.job_image
  deploy_services                       = var.deploy_services
  crm_public_origin                     = var.crm_public_origin
  access_recovery_enabled               = var.access_recovery_enabled
  gmail_invitation_enabled              = var.gmail_invitation_enabled
  gmail_sender_email                    = var.gmail_sender_email
  gmail_secret_versions                 = var.gmail_secret_versions
  deployer_service_account_email        = var.deployer_service_account_email
  sheet_append_storage_prepared         = var.sheet_append_storage_prepared
  sheet_append_runtime_prepared         = var.sheet_append_runtime_prepared
  sheet_append_enabled                  = var.sheet_append_enabled
  sheet_append_observation_verified     = var.sheet_append_observation_verified
  sheet_append_scheduler_paused         = var.sheet_append_scheduler_paused
  sheet_append_artifact_objects         = var.sheet_append_artifact_objects
  sheet_append_artifact_sha256          = var.sheet_append_artifact_sha256
  sheet_append_expected_boundary_sha256 = "832763475bb07aeaf3b631efe6c43c93b448d782f4ce71420702e2f1acf6e4ed"
}
output "runtime" { value = module.runtime }
