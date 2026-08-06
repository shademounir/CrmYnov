variable "bootstrap_project_id" {
  description = "Approved bootstrap project ID."
  type        = string
  default     = "crmynov-bst-n7x4q2"
}

variable "region" {
  description = "Primary bucket region."
  type        = string
  default     = "europe-southwest1"
}

variable "terraform_service_account_email" {
  description = "Optional tf-bootstrap identity to impersonate after Phase 1."
  type        = string
  default     = null
  nullable    = true
}

variable "state_iam_bindings" {
  description = "Independent IAM bindings keyed by bootstrap, dev, staging, and prod."
  type        = map(map(set(string)))
  default     = {}

  validation {
    condition = alltrue(flatten([
      for bindings in values(var.state_iam_bindings) : [
        for role in keys(bindings) : !contains(["roles/owner", "roles/editor"], lower(role))
      ]
    ]))
    error_message = "Owner and Editor are forbidden in state bucket IAM."
  }
}
