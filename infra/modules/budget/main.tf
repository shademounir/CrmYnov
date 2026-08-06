resource "google_billing_budget" "this" {
  billing_account = var.billing_account_id
  display_name    = var.display_name

  amount {
    specified_amount {
      currency_code = var.currency_code
      units         = tostring(floor(var.amount))
      nanos         = floor((var.amount - floor(var.amount)) * 1000000000)
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

}
