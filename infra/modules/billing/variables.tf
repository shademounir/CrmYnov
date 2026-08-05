variable "project_id" {
  description = "Project to associate with billing."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account ID injected securely at execution time."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}$", var.billing_account_id))
    error_message = "billing_account_id must use the Google Cloud billing account format."
  }
}
