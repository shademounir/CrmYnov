output "terraform_bootstrap_service_account" {
  description = "Service account to impersonate for controlled Terraform execution."
  value       = module.terraform_bootstrap.email
}

output "github_deploy_service_accounts" {
  description = "Separated deployment identities by environment."
  value       = { for environment, account in module.github_deploy : environment => account.email }
}

output "workload_identity_providers" {
  description = "Separated WIF provider resource names by environment."
  value       = { for environment, provider in module.github_wif : environment => provider.provider_name }
}
