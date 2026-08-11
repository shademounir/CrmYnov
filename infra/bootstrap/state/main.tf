locals {
  state_buckets = {
    bootstrap = "crmynov-tfstate-bst-n7x4q2"
    dev       = "crmynov-tfstate-dev-n7x4q2"
    staging   = "crmynov-tfstate-stg-n7x4q2"
    prod      = "crmynov-tfstate-prod-n7x4q2"
  }
}

module "state" {
  source   = "../../modules/terraform-state"
  for_each = local.state_buckets

  project_id   = var.bootstrap_project_id
  name         = each.value
  location     = upper(var.region)
  iam_bindings = lookup(var.state_iam_bindings, each.key, {})
}
