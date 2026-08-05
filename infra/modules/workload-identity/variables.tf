variable "project_id" {
  description = "Bootstrap project hosting the identity pool and provider."
  type        = string
}

variable "pool_id" {
  description = "Workload Identity Pool ID."
  type        = string
}

variable "provider_id" {
  description = "Workload Identity Provider ID."
  type        = string
}

variable "display_name" {
  description = "Provider display name."
  type        = string
}

variable "attribute_condition" {
  description = "CEL condition restricting repository, numeric IDs, ref, and environment."
  type        = string
}

variable "repository" {
  description = "Exact GitHub owner/repository claim."
  type        = string
}

variable "service_account_name" {
  description = "Canonical target service account name."
  type        = string
}
