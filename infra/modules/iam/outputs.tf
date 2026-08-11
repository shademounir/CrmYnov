output "roles" {
  description = "Roles managed by this module."
  value       = sort(distinct([for binding in google_project_iam_member.this : binding.role]))
}
