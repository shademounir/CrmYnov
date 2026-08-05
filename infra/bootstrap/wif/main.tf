locals {
  environments = {
    dev = {
      project_id    = var.environment_project_ids.dev
      account_id    = "gh-deploy-dev"
      pool_id       = "github-dev"
      provider_id   = "github-dev"
      environment   = "DEV"
      ref_condition = "assertion.ref == 'refs/heads/develop'"
    }
    staging = {
      project_id    = var.environment_project_ids.staging
      account_id    = "gh-deploy-staging"
      pool_id       = "github-staging"
      provider_id   = "github-staging"
      environment   = "STAGING"
      ref_condition = "assertion.ref.startsWith('refs/heads/release/')"
    }
    prod = {
      project_id    = var.environment_project_ids.prod
      account_id    = "gh-deploy-prod"
      pool_id       = "github-prod"
      provider_id   = "github-prod"
      environment   = "PROD"
      ref_condition = "assertion.ref == 'refs/heads/main'"
    }
  }

  terraform_bootstrap_member = "serviceAccount:${module.terraform_bootstrap.email}"
  managed_projects = merge(
    { bootstrap = var.bootstrap_project_id },
    var.environment_project_ids,
  )
}

module "terraform_bootstrap" {
  source = "../../modules/service-account"

  project_id   = var.bootstrap_project_id
  account_id   = "tf-bootstrap"
  display_name = "Terraform Bootstrap"
  description  = "Keyless identity used only through controlled impersonation."
}

module "github_deploy" {
  source   = "../../modules/service-account"
  for_each = local.environments

  project_id   = each.value.project_id
  account_id   = each.value.account_id
  display_name = "GitHub Deploy ${each.value.environment}"
  description  = "Keyless deployment identity restricted to ${each.value.environment}."
}

module "github_wif" {
  source   = "../../modules/workload-identity"
  for_each = local.environments

  project_id           = var.bootstrap_project_id
  pool_id              = each.value.pool_id
  provider_id          = each.value.provider_id
  display_name         = "GitHub ${each.value.environment}"
  repository           = var.github_repository
  service_account_name = module.github_deploy[each.key].name
  attribute_condition = join(" && ", [
    "assertion.repository == '${var.github_repository}'",
    "assertion.repository_id == '${var.github_repository_id}'",
    "assertion.repository_owner_id == '${var.github_repository_owner_id}'",
    each.value.ref_condition,
    "assertion.environment == '${each.value.environment}'",
  ])
}

resource "google_service_account_iam_member" "terraform_impersonation" {
  for_each = var.terraform_impersonators

  service_account_id = module.terraform_bootstrap.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = each.value
}

resource "google_folder_iam_member" "terraform_project_creator" {
  folder = var.folder_id
  role   = "roles/resourcemanager.projectCreator"
  member = local.terraform_bootstrap_member
}

resource "google_billing_account_iam_member" "terraform_billing_user" {
  billing_account_id = var.billing_account_id
  role               = "roles/billing.user"
  member             = local.terraform_bootstrap_member
}

resource "google_billing_account_iam_member" "terraform_billing_costs_manager" {
  billing_account_id = var.billing_account_id
  role               = "roles/billing.costsManager"
  member             = local.terraform_bootstrap_member
}

module "terraform_project_iam" {
  source   = "../../modules/iam"
  for_each = local.managed_projects

  project_id = each.value
  bindings = {
    "roles/iam.serviceAccountAdmin"         = toset([local.terraform_bootstrap_member])
    "roles/resourcemanager.projectIamAdmin" = toset([local.terraform_bootstrap_member])
    "roles/serviceusage.serviceUsageAdmin"  = toset([local.terraform_bootstrap_member])
  }
}

module "terraform_bootstrap_project_iam" {
  source = "../../modules/iam"

  project_id = var.bootstrap_project_id
  bindings = {
    "roles/iam.workloadIdentityPoolAdmin" = toset([local.terraform_bootstrap_member])
    "roles/storage.admin"                 = toset([local.terraform_bootstrap_member])
  }
}
