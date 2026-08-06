# Budget policy

The billing API returned `USD`. The Product Owner's provisional limits are
expressed as MAD equivalents: Bootstrap 100, DEV 200, STAGING 100, PROD 100,
and total 500. No exchange rate or converted USD value is embedded in code.

Before any apply, the Product Owner must approve explicit amounts in the actual
billing currency. Terraform accepts those values as sensitive execution inputs.

Every budget is alert-only:

- actual spend: 50%, 80%, 100%;
- forecasted spend: 100%;
- no automatic shutdown, quota change, or resource mutation.
