locals {
  phase0_services = toset([
    "cloudbilling.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
  ])
}

resource "google_project" "bootstrap" {
  project_id          = var.bootstrap_project_id
  name                = "CRM Ynov Bootstrap"
  org_id              = var.bootstrap_parent_folder_id == null ? var.organization_id : null
  folder_id           = var.bootstrap_parent_folder_id
  labels              = var.common_labels
  auto_create_network = false
  deletion_policy     = "PREVENT"
}

resource "google_billing_project_info" "bootstrap" {
  project         = google_project.bootstrap.project_id
  billing_account = var.billing_account_id
}

resource "google_project_service" "phase0" {
  for_each = local.phase0_services

  project            = google_project.bootstrap.project_id
  service            = each.value
  disable_on_destroy = false

  depends_on = [google_billing_project_info.bootstrap]
}
