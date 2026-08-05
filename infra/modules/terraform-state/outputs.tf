output "name" {
  description = "State bucket name."
  value       = google_storage_bucket.this.name
}

output "url" {
  description = "State bucket URL."
  value       = google_storage_bucket.this.url
}
