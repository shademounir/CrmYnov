variable "bootstrap_project_id" {
  description = "Project hosting WIF and transverse bootstrap controls."
  type        = string
  default     = "crmynov-bst-n7x4q2"
}

variable "environment_project_ids" {
  description = "Approved environment project IDs."
  type        = map(string)
  default = {
    dev     = "crmynov-dev-n7x4q2"
    staging = "crmynov-stg-n7x4q2"
    prod    = "crmynov-prod-n7x4q2"
  }
}

variable "folder_id" {
  description = "CRM folder identifier produced by Phase 0."
  type        = string
}

variable "billing_account_id" {
  description = "Full billing account ID injected securely at execution time."
  type        = string
  sensitive   = true
}

variable "region" {
  description = "Primary region."
  type        = string
  default     = "europe-southwest1"
}

variable "bootstrap_administrator_service_account_email" {
  description = "Optional pre-existing, approved administrator identity to impersonate for the WIF/security root. Null means the authorized human executes directly. It must never be tf-bootstrap."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.bootstrap_administrator_service_account_email == null ||
      var.bootstrap_administrator_service_account_email != "tf-bootstrap@${var.bootstrap_project_id}.iam.gserviceaccount.com"
    )
    error_message = "The WIF/security root must be executed by an authorized human or a distinct pre-existing administrator identity; tf-bootstrap cannot administer itself."
  }
}

variable "terraform_impersonators" {
  description = "Human or group principals allowed to impersonate tf-bootstrap."
  type        = set(string)
  default     = []
}

variable "github_repository" {
  description = "Exact GitHub repository claim."
  type        = string
  default     = "shademounir/CrmYnov"
}

variable "github_repository_id" {
  description = "Numeric GitHub repository ID."
  type        = string
  default     = "1313619083"
}

variable "github_repository_owner_id" {
  description = "Numeric GitHub repository owner ID."
  type        = string
  default     = "151538330"
}
