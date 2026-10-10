locals {
  project_id = "crmynov-prod-n7x4q2"
  region     = "europe-west1"
}
provider "google" {
  project = local.project_id
  region  = local.region
}
module "runtime" {
  source                         = "../../modules/runtime-pilot"
  environment                    = "prod"
  billing_account_id             = var.billing_account_id
  operations_alert_email         = var.operations_alert_email
  api_image                      = var.api_image
  web_image                      = var.web_image
  job_image                      = var.job_image
  deploy_services                = var.deploy_services
  crm_public_origin              = var.crm_public_origin
  access_recovery_enabled        = var.access_recovery_enabled
  gmail_invitation_enabled       = var.gmail_invitation_enabled
  gmail_sender_email             = var.gmail_sender_email
  gmail_secret_versions          = var.gmail_secret_versions
  deployer_service_account_email = var.deployer_service_account_email
}
output "runtime" { value = module.runtime }
