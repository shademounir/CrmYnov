output "provider_name" {
  description = "Canonical Workload Identity Provider resource name."
  value       = google_iam_workload_identity_pool_provider.this.name
}

output "pool_name" {
  description = "Canonical Workload Identity Pool resource name."
  value       = google_iam_workload_identity_pool.this.name
}
