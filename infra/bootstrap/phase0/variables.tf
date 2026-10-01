variable "organization_id" {
  type        = string
  description = "Product Owner-approved numeric organization ID."
  default     = "1046537507934"
  validation {
    condition     = var.organization_id == "1046537507934"
    error_message = "organization_id is not the approved organization."
  }
}

variable "bootstrap_project_id" {
  type        = string
  description = "Permanent bootstrap project ID; no seed project is allowed."
  default     = "crmynov-bst-n7x4q2"
  validation {
    condition     = var.bootstrap_project_id == "crmynov-bst-n7x4q2"
    error_message = "bootstrap_project_id is not approved."
  }
}

variable "bootstrap_parent_folder_id" {
  type        = string
  description = "Optional folder ID used later by this same state to move the project non-destructively."
  default     = null
  nullable    = true
}

variable "billing_account_id" {
  type        = string
  description = "Billing account injected outside Git during a separately authorized execution."
  sensitive   = true
  validation {
    condition     = can(regex("^[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}$", var.billing_account_id))
    error_message = "billing_account_id must use the Google Cloud billing account format."
  }
}

variable "region" {
  type        = string
  description = "Approved primary region."
  default     = "europe-southwest1"
  validation {
    condition     = var.region == "europe-southwest1"
    error_message = "region is not approved."
  }
}

variable "common_labels" {
  type        = map(string)
  description = "Approved non-sensitive bootstrap labels."
  default = {
    application = "crm-ynov"
    environment = "bootstrap"
    managed-by  = "terraform"
    owner       = "admissions"
    phase       = "phase-0"
  }
}
