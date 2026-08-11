resource "google_billing_project_info" "this" {
  project         = var.project_id
  billing_account = var.billing_account_id
}
