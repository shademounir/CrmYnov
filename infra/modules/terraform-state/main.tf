resource "google_storage_bucket" "this" {
  project                     = var.project_id
  name                        = var.name
  location                    = var.location
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  members = flatten([
    for role, members in var.iam_bindings : [
      for member in members : {
        key    = "${role}/${member}"
        role   = role
        member = member
      }
    ]
  ])
}

resource "google_storage_bucket_iam_member" "this" {
  for_each = { for binding in local.members : binding.key => binding }

  bucket = google_storage_bucket.this.name
  role   = each.value.role
  member = each.value.member
}
