output "project_id" {
  description = "Project associated with the billing account."
  value       = google_billing_project_info.this.project
}
