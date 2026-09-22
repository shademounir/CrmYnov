variable "project_id" {
  description = "Existing CRM Ynov DEV project."
  type        = string
  default     = "crmynov-dev-n7x4q2"
  validation {
    condition     = var.project_id == "crmynov-dev-n7x4q2"
    error_message = "This root is restricted to the existing DEV project."
  }
}
variable "region" {
  type    = string
  default = "europe-west1"
  validation {
    condition     = var.region == "europe-west1"
    error_message = "The authorized first DEV deployment is restricted to europe-west1."
  }
}
variable "api_image" {
  description = "Immutable API image digest. Empty during foundation-only planning."
  type        = string
  default     = ""
  validation {
    condition     = var.api_image == "" || can(regex("@sha256:[0-9a-f]{64}$", var.api_image))
    error_message = "api_image must be empty or an immutable digest."
  }
}
variable "web_image" {
  description = "Immutable Web image digest. Empty during foundation-only planning."
  type        = string
  default     = ""
  validation {
    condition     = var.web_image == "" || can(regex("@sha256:[0-9a-f]{64}$", var.web_image))
    error_message = "web_image must be empty or an immutable digest."
  }
}

variable "deploy_services" {
  description = "Create Web/API services only after migrate, grants and synthetic seed jobs have completed successfully."
  type        = bool
  default     = false
}

variable "scheduler_paused" {
  description = "Keep background execution paused until the API and due job have passed deployment smoke tests."
  type        = bool
  default     = true
}
variable "wif_deploy_principal" {
  description = "Existing Bootstrap WIF principalSet for the DEV GitHub environment."
  type        = string
  default     = ""
  validation {
    condition     = var.wif_deploy_principal == "" || startswith(var.wif_deploy_principal, "principalSet://iam.googleapis.com/")
    error_message = "Use the existing WIF principalSet; keys are not accepted."
  }
}
variable "billing_account_id" {
  type      = string
  default   = ""
  sensitive = true
}
variable "manage_budget" {
  type    = bool
  default = false
}
variable "budget_amount_usd" {
  type    = number
  default = 150
  validation {
    condition     = var.budget_amount_usd > 0 && var.budget_amount_usd <= 150
    error_message = "DEV estimate authorization is limited to 150 USD/month."
  }
}
variable "budget_notification_channels" {
  type    = set(string)
  default = []
}
