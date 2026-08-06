variable "project_id" {
  description = "Project hosting the service account."
  type        = string
}

variable "account_id" {
  description = "Service account short ID."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.account_id))
    error_message = "account_id must satisfy Google service account naming rules."
  }
}

variable "display_name" {
  description = "Service account display name."
  type        = string
}

variable "description" {
  description = "Non-sensitive purpose statement."
  type        = string
}
