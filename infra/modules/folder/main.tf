resource "google_folder" "this" {
  display_name = var.display_name
  parent       = "organizations/${var.organization_id}"
}
