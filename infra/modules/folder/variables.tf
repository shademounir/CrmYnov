variable "organization_id" {
  description = "Numeric Google Cloud organization identifier."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.organization_id))
    error_message = "organization_id must contain digits only."
  }
}

variable "display_name" {
  description = "Human-readable folder name."
  type        = string
}
