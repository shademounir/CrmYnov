variable "billing_account_id" {
  description = "Billing account owning the budget."
  type        = string
  sensitive   = true
}

variable "display_name" {
  description = "Budget display name."
  type        = string
}

variable "currency_code" {
  description = "ISO 4217 billing currency confirmed from the billing API."
  type        = string

  validation {
    condition     = can(regex("^[A-Z]{3}$", var.currency_code))
    error_message = "currency_code must be a three-letter ISO 4217 code."
  }
}

variable "amount" {
  description = "Monthly budget amount in currency_code."
  type        = number

  validation {
    condition     = var.amount > 0
    error_message = "amount must be greater than zero."
  }
}

variable "project_numbers" {
  description = "Numeric projects included in the budget filter."
  type        = set(string)

  validation {
    condition     = length(var.project_numbers) > 0 && alltrue([for number in var.project_numbers : can(regex("^[0-9]+$", number))])
    error_message = "project_numbers must contain at least one numeric project identifier."
  }
}
