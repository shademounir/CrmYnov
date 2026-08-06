output "email" {
  description = "Service account email address."
  value       = google_service_account.this.email
}

output "name" {
  description = "Canonical service account resource name."
  value       = google_service_account.this.name
}
