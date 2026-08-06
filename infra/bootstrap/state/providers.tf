provider "google" {
  project                     = var.bootstrap_project_id
  region                      = var.region
  impersonate_service_account = var.terraform_service_account_email
}
