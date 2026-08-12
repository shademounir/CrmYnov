locals {
  amount_units = floor(var.amount_cents / 100)
  amount_nanos = (var.amount_cents % 100) * 10000000
}

resource "google_billing_budget" "this" {
  billing_account = var.billing_account_id
  display_name    = var.display_name

  amount {
    specified_amount {
      currency_code = var.currency_code
      units         = tostring(local.amount_units)
      nanos         = local.amount_nanos
    }
  }

  budget_filter {
    projects = [for number in sort(tolist(var.project_numbers)) : "projects/${number}"]
  }

  threshold_rules {
    threshold_percent = 0.50
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 0.80
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.00
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.00
    spend_basis       = "FORECASTED_SPEND"
  }

  lifecycle {
    precondition {
      condition = (
        local.amount_nanos >= 0 &&
        local.amount_nanos <= 999999999 &&
        local.amount_nanos % 10000000 == 0
      )
      error_message = "Budget nanos must be within API bounds and use exact cent increments."
    }
  }

}
