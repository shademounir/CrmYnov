module "state" {
  source = "../../modules/terraform-state"

  project_id   = var.project_id
  name         = var.bucket_name
  location     = upper(var.region)
  iam_bindings = var.state_iam_bindings
}
