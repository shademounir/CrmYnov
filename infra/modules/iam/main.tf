locals {
  members = flatten([
    for role, members in var.bindings : [
      for member in members : {
        key    = "${role}/${member}"
        role   = role
        member = member
      }
    ]
  ])
}

resource "google_project_iam_member" "this" {
  for_each = { for binding in local.members : binding.key => binding }

  project = var.project_id
  role    = each.value.role
  member  = each.value.member
}
