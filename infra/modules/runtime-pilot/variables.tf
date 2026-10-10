variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "This module manages only canonical STAGING or PROD, never DEV or Bootstrap."
  }
}

variable "billing_account_id" {
  type      = string
  sensitive = true
  validation {
    condition     = can(regex("^[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}$", var.billing_account_id))
    error_message = "Inject the authorized billing account privately; do not commit it."
  }
}

variable "operations_alert_email" {
  description = "Authorized recipient, injected privately. Creation does not prove alert receipt."
  type        = string
  sensitive   = true
  validation {
    condition     = can(regex("^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$", var.operations_alert_email))
    error_message = "An authorized operational alert mailbox is required."
  }
}

variable "api_image" {
  type    = string
  default = ""
  validation {
    condition     = var.api_image == "" || can(regex("@sha256:[0-9a-f]{64}$", var.api_image))
    error_message = "API images must be immutable; tags are forbidden."
  }
}
variable "web_image" {
  type    = string
  default = ""
  validation {
    condition     = var.web_image == "" || can(regex("@sha256:[0-9a-f]{64}$", var.web_image))
    error_message = "Web images must be immutable; tags are forbidden."
  }
}
variable "job_image" {
  description = "Optional separately reviewed immutable API digest for pre-service migrations."
  type        = string
  default     = ""
  validation {
    condition     = var.job_image == "" || can(regex("@sha256:[0-9a-f]{64}$", var.job_image))
    error_message = "Job images must be immutable; tags are forbidden."
  }
}
variable "deploy_services" {
  description = "Explicitly open services only after migrations, grants and target qualification. No seed is run."
  type        = bool
  default     = false
}
variable "crm_public_origin" {
  description = "Exact reviewed HTTPS origin, required before Gmail/recovery. Initial Cloud Run smoke may use its native URI with both OFF."
  type        = string
  default     = ""
  validation {
    condition = var.crm_public_origin == "" || (
      can(regex("^https://[a-z0-9][a-z0-9.-]*[a-z0-9]$", var.crm_public_origin)) &&
      !strcontains(var.crm_public_origin, "crm-dev-") &&
      !strcontains(var.crm_public_origin, "localhost")
    )
    error_message = "Use a reviewed HTTPS origin without path, credentials, DEV hostname or localhost."
  }
}
variable "access_recovery_enabled" {
  type    = bool
  default = false
}
variable "gmail_invitation_enabled" {
  description = "Separate target qualification and mailbox consent are required before enabling."
  type        = bool
  default     = false
}
variable "gmail_sender_email" {
  type      = string
  default   = ""
  sensitive = true
}
variable "gmail_secret_versions" {
  description = "Explicit existing numeric versions in this target only: client_id, client_secret, refresh_token. No secret values."
  type        = map(string)
  default     = {}
  validation {
    condition     = alltrue([for version in values(var.gmail_secret_versions) : can(regex("^[1-9][0-9]*$", version))])
    error_message = "Pin existing numeric secret versions; latest and payloads are forbidden."
  }
}
variable "deployer_service_account_email" {
  description = "Optional existing target gh-deploy identity owned by Security bootstrap. No WIF provider or key is created here."
  type        = string
  default     = ""
}
