variable "project_id" {
  description = "Project receiving IAM bindings."
  type        = string
}

variable "bindings" {
  description = "Role-to-members mapping. Owner and Editor are prohibited."
  type        = map(set(string))
  default     = {}

  validation {
    condition = alltrue([
      for role in keys(var.bindings) : !contains(["roles/owner", "roles/editor"], lower(role))
    ])
    error_message = "Owner and Editor roles are forbidden for managed IAM bindings."
  }
}
