variable "billing_account_id" {
  type      = string
  sensitive = true
}
variable "operations_alert_email" {
  type      = string
  sensitive = true
}
variable "api_image" {
  type    = string
  default = ""
}
variable "web_image" {
  type    = string
  default = ""
}
variable "job_image" {
  type    = string
  default = ""
}
variable "deploy_services" {
  type    = bool
  default = false
}
variable "crm_public_origin" {
  type    = string
  default = ""
}
variable "access_recovery_enabled" {
  type    = bool
  default = false
}
variable "gmail_invitation_enabled" {
  type    = bool
  default = false
}
variable "gmail_sender_email" {
  type      = string
  default   = ""
  sensitive = true
}
variable "gmail_secret_versions" {
  type    = map(string)
  default = {}
}
variable "deployer_service_account_email" {
  type    = string
  default = ""
}
variable "sheet_append_storage_prepared" {
  type    = bool
  default = false
}
variable "sheet_append_runtime_prepared" {
  type    = bool
  default = false
}
variable "sheet_append_enabled" {
  type    = bool
  default = false
}
variable "sheet_append_observation_verified" {
  type    = bool
  default = false
}
variable "sheet_append_scheduler_paused" {
  type    = bool
  default = true
}
variable "sheet_append_artifact_objects" {
  type    = map(string)
  default = {}
}
variable "sheet_append_artifact_sha256" {
  type    = map(string)
  default = {}
}
