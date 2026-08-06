variable "project_id" {
  description = "Bootstrap project hosting the state bucket."
  type        = string
}

variable "name" {
  description = "Globally unique bucket name."
  type        = string
}

variable "location" {
  description = "Bucket location."
  type        = string
  default     = "EUROPE-SOUTHWEST1"
}

variable "iam_bindings" {
  description = "Explicit role-to-members map for this state perimeter."
  type        = map(set(string))
  default     = {}
}
