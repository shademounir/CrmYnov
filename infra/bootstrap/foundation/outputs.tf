output "folder_id" {
  description = "Created CRM folder identifier."
  value       = module.folder.id
}

output "projects" {
  description = "Project IDs and numeric identifiers for later phases."
  value = merge({
    bootstrap = {
      id     = data.google_project.bootstrap.project_id
      number = data.google_project.bootstrap.number
    }
    }, {
    for environment, project in module.projects : environment => {
      id     = project.id
      number = project.number
    }
  })
}

output "budget_currency" {
  description = "Currency used by parameterized budgets."
  value       = var.budget_currency
}
