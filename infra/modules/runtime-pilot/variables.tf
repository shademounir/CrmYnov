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
variable "api_memory" {
  description = "Reviewed API memory tier only; Web/jobs and scaling bounds remain unchanged."
  type        = string
  default     = "512Mi"
  validation {
    condition     = contains(["512Mi", "1Gi"], var.api_memory)
    error_message = "Only the bounded pilot API tiers 512Mi and 1Gi are supported."
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

variable "sheet_append_storage_prepared" {
  description = "Create the target-private immutable artifact store and dedicated identities. This does not mount artifacts or enable ingestion."
  type        = bool
  default     = false
}
variable "sheet_append_runtime_prepared" {
  description = "Mount already uploaded, hash-pinned artifacts and provision the isolated worker/Scheduler PAUSED. Ingestion still stays OFF."
  type        = bool
  default     = false
}
variable "sheet_append_enabled" {
  description = "Literal activation gate for the API and isolated append worker. It does not unpause Scheduler."
  type        = bool
  default     = false
}
variable "sheet_append_observation_verified" {
  description = "Operator evidence that one real post-boundary execution completed and was reconciled before Scheduler can be unpaused."
  type        = bool
  default     = false
}
variable "sheet_append_scheduler_paused" {
  description = "Independent append Scheduler control. Rollback sets this true and sheet_append_enabled false without changing cursors."
  type        = bool
  default     = true
}
variable "sheet_append_artifact_objects" {
  description = "Private bucket object basenames for boundary, qualification and allowlist. Names must include their pinned SHA-256."
  type        = map(string)
  default     = {}
  validation {
    condition = alltrue([
      for name in values(var.sheet_append_artifact_objects) :
      can(regex("^[a-z0-9][a-z0-9._-]{0,190}\\.json$", name)) && !strcontains(name, "..")
    ])
    error_message = "Artifact names must be bounded JSON basenames without paths or traversal."
  }
}
variable "sheet_append_artifact_sha256" {
  description = "Lowercase SHA-256 values for boundary, qualification and allowlist; payloads remain outside Terraform state."
  type        = map(string)
  default     = {}
  validation {
    condition     = alltrue([for digest in values(var.sheet_append_artifact_sha256) : can(regex("^[a-f0-9]{64}$", digest))])
    error_message = "Every Sheets artifact digest must be an exact lowercase SHA-256."
  }
}
variable "sheet_append_expected_boundary_sha256" {
  description = "Canonical target root pins the previously captured immutable boundary. Empty is permitted only while runtime is not prepared."
  type        = string
  default     = ""
  validation {
    condition     = var.sheet_append_expected_boundary_sha256 == "" || can(regex("^[a-f0-9]{64}$", var.sheet_append_expected_boundary_sha256))
    error_message = "The expected boundary must be empty or one exact lowercase SHA-256."
  }
}
