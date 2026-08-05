provider "google" {
  project                     = var.bootstrap_project_id
  region                      = var.region
  impersonate_service_account = var.bootstrap_administrator_service_account_email
}
