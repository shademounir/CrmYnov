output "id" {
  description = "Project identifier."
  value       = google_project.this.project_id
}

output "number" {
  description = "Numeric project identifier."
  value       = google_project.this.number
}
