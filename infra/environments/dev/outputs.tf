output "artifact_repository" { value = google_artifact_registry_repository.containers.name }
output "api_uri" { value = local.deploy_services ? google_cloud_run_v2_service.api[0].uri : null }
output "web_uri" { value = local.deploy_services ? google_cloud_run_v2_service.web[0].uri : null }
output "database_instance" { value = google_sql_database_instance.postgres.connection_name }
output "deploy_service_account" { value = google_service_account.deploy.email }
output "synthetic_login_secret" {
  description = "Secret resource only; the credential value is never output."
  value       = google_secret_manager_secret.synthetic_login.id
}
