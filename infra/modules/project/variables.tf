variable "project_id" {
  description = "Globally unique Google Cloud project identifier."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must satisfy Google Cloud project ID rules."
  }
}

variable "name" {
  description = "Project display name."
  type        = string
}

variable "folder_id" {
  description = "Parent folder identifier without the folders/ prefix."
  type        = string
}

variable "labels" {
  description = "Non-sensitive project labels."
  type        = map(string)
  default     = {}
}
