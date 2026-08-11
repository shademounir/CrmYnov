output "id" {
  description = "Folder identifier without the folders/ prefix."
  value       = google_folder.this.folder_id
}

output "name" {
  description = "Canonical folder resource name."
  value       = google_folder.this.name
}
