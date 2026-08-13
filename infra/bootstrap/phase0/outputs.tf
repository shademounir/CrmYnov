output "bootstrap_project" {
  description = "Non-sensitive identifiers consumed by Foundation Phase 1."
  value = {
    id     = google_project.bootstrap.project_id
    number = google_project.bootstrap.number
  }
}

output "phase0_services" {
  description = "Closed allowlist owned by the Phase 0 state."
  value       = sort(tolist(local.phase0_services))
}
