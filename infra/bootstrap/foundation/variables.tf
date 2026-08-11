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
  description = "Billing currency read from the account API. USD was observed during Gate -1."
  type        = string
  default     = "USD"

  validation {
    condition     = can(regex("^[A-Z]{3}$", var.budget_currency))
    error_message = "budget_currency must be a three-letter ISO 4217 code."
  }
}

variable "budget_amounts" {
  description = "Approved monthly amounts in budget_currency. No MAD-to-USD conversion is embedded."
  type = object({
    bootstrap = number
    dev       = number
    staging   = number
    prod      = number
    folder    = number
  })

  validation {
    condition     = alltrue([for amount in values(var.budget_amounts) : amount > 0])
    error_message = "Every approved budget amount must be greater than zero."
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
