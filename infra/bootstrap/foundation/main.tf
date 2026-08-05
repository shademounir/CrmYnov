locals {
  projects = {
    bootstrap = {
      id   = "crmynov-bst-n7x4q2"
      name = "CRM Ynov Bootstrap"
    }
    dev = {
      id   = "crmynov-dev-n7x4q2"
      name = "CRM Ynov Development"
    }
    staging = {
      id   = "crmynov-stg-n7x4q2"
      name = "CRM Ynov Staging"
    }
    prod = {
      id   = "crmynov-prod-n7x4q2"
      name = "CRM Ynov Production"
    }
  }

  required_services = {
    bootstrap = toset([
      "billingbudgets.googleapis.com",
      "cloudbilling.googleapis.com",
      "cloudresourcemanager.googleapis.com",
      "iam.googleapis.com",
      "iamcredentials.googleapis.com",
      "serviceusage.googleapis.com",
      "storage.googleapis.com",
      "sts.googleapis.com",
    ])
    dev = toset([
      "iam.googleapis.com",
      "iamcredentials.googleapis.com",
      "serviceusage.googleapis.com",
    ])
    staging = toset([
      "iam.googleapis.com",
      "iamcredentials.googleapis.com",
      "serviceusage.googleapis.com",
    ])
    prod = toset([
      "iam.googleapis.com",
      "iamcredentials.googleapis.com",
      "serviceusage.googleapis.com",
    ])
  }

  service_pairs = flatten([
    for environment, services in local.required_services : [
      for service in services : {
        key         = "${environment}/${service}"
        environment = environment
        service     = service
      }
    ]
  ])

  budget_specs = {
    bootstrap = {
      display_name    = "CRM Ynov Bootstrap monthly budget"
      amount          = var.budget_amounts.bootstrap
      project_numbers = toset([module.projects["bootstrap"].number])
    }
    dev = {
      display_name    = "CRM Ynov Development monthly budget"
      amount          = var.budget_amounts.dev
      project_numbers = toset([module.projects["dev"].number])
    }
    staging = {
      display_name    = "CRM Ynov Staging monthly budget"
      amount          = var.budget_amounts.staging
      project_numbers = toset([module.projects["staging"].number])
    }
    prod = {
      display_name    = "CRM Ynov Production monthly budget"
      amount          = var.budget_amounts.prod
      project_numbers = toset([module.projects["prod"].number])
    }
    folder = {
      display_name    = "CRM Ynov four-project monthly budget"
      amount          = var.budget_amounts.folder
      project_numbers = toset([for project in module.projects : project.number])
    }
  }
}

module "folder" {
  source = "../../modules/folder"

  organization_id = var.organization_id
  display_name    = var.folder_display_name
}

module "projects" {
  source   = "../../modules/project"
  for_each = local.projects

  project_id = each.value.id
  name       = each.value.name
  folder_id  = module.folder.id
  labels = merge(var.common_labels, {
    environment = each.key
  })
}

module "billing" {
  source   = "../../modules/billing"
  for_each = local.projects

  project_id         = module.projects[each.key].id
  billing_account_id = var.billing_account_id
}

resource "google_project_service" "required" {
  for_each = { for pair in local.service_pairs : pair.key => pair }

  project            = module.projects[each.value.environment].id
  service            = each.value.service
  disable_on_destroy = false

  depends_on = [module.billing]
}

module "budgets" {
  source   = "../../modules/budget"
  for_each = local.budget_specs

  billing_account_id = var.billing_account_id
  display_name       = each.value.display_name
  currency_code      = var.budget_currency
  amount             = each.value.amount
  project_numbers    = each.value.project_numbers

  depends_on = [google_project_service.required]
}
