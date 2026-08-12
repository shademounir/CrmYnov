variable "organization_id" {
  description = "Numeric organization ID validated by the Product Owner."
  type        = string
  default     = "1046537507934"
}

variable "folder_display_name" {
  description = "Future CRM folder display name."
  type        = string
  default     = "CRM Ynov"
}

variable "region" {
  description = "Primary Google Cloud region."
  type        = string
  default     = "europe-southwest1"
}

variable "billing_account_id" {
  description = "Full billing account ID, injected securely only during an authorized execution."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}$", var.billing_account_id))
    error_message = "billing_account_id must use the Google Cloud billing account format."
  }
}

variable "budget_currency" {
  description = "Billing currency approved by the Product Owner for Foundation budgets."
  type        = string
  default     = "USD"

  validation {
    condition     = var.budget_currency == "USD"
    error_message = "budget_currency must remain USD for the approved Foundation budget contract."
  }
}

variable "budget_amount_cents" {
  description = "Approved monthly Foundation budgets expressed as integer cents, the sole monetary source of truth."
  type = object({
    bootstrap = number
    dev       = number
    staging   = number
    prod      = number
    folder    = number
  })

  validation {
    condition = alltrue([
      for amount_cents in values(var.budget_amount_cents) :
      amount_cents > 0 && amount_cents == floor(amount_cents)
    ])
    error_message = "Every approved budget must be a strictly positive integer number of cents."
  }

  validation {
    condition = (
      var.budget_amount_cents.bootstrap +
      var.budget_amount_cents.dev +
      var.budget_amount_cents.staging +
      var.budget_amount_cents.prod
    ) == var.budget_amount_cents.folder
    error_message = "The folder budget must exactly equal the sum of bootstrap, dev, staging, and prod budgets."
  }
}

variable "terraform_service_account_email" {
  description = "Optional tf-bootstrap service account to impersonate after Phase 1."
  type        = string
  default     = null
  nullable    = true
}

variable "common_labels" {
  description = "Non-sensitive labels applied to every project."
  type        = map(string)
  default = {
    application = "crm-ynov"
    managed-by  = "terraform"
    owner       = "admissions"
    phase       = "foundation"
  }
}
