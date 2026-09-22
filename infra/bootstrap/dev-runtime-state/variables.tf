variable "project_id" {
  type    = string
  default = "crmynov-dev-n7x4q2"
  validation {
    condition     = var.project_id == "crmynov-dev-n7x4q2"
    error_message = "This one-time bootstrap is restricted to CRM Ynov DEV."
  }
}

variable "region" {
  type    = string
  default = "europe-west1"
}

variable "bucket_name" {
  type    = string
  default = "crmynov-runtime-tfstate-dev-n7x4q2"
}

variable "state_iam_bindings" {
  description = "Exact state consumers added only after their identities exist."
  type        = map(set(string))
  default     = {}
  validation {
    condition     = alltrue([for role in keys(var.state_iam_bindings) : !contains(["roles/owner", "roles/editor"], lower(role))])
    error_message = "Primitive Owner and Editor roles are forbidden."
  }
}
