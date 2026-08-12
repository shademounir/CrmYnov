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
  description = "Approved Foundation billing currency."
  type        = string

  validation {
    condition     = var.currency_code == "USD"
    error_message = "currency_code must remain USD for Foundation budgets."
  }
}

variable "amount_cents" {
  description = "Monthly budget amount expressed as integer cents."
  type        = number

  validation {
    condition     = var.amount_cents > 0 && var.amount_cents == floor(var.amount_cents)
    error_message = "amount_cents must be a strictly positive integer number of cents."
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
