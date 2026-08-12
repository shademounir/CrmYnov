# Budget policy

The billing currency is `USD`. The Product Owner approved monthly alert budgets
of USD 8.33 for Bootstrap, USD 41.67 for DEV, USD 33.33 for STAGING, USD 100.00
for PROD, and USD 183.33 for the aggregate four-project folder budget.

Terraform stores the source values exclusively as integer cents: 833, 4167,
3333, 10000, and 18333. The aggregate invariant is exact:
`833 + 4167 + 3333 + 10000 = 18333`. No exchange rate or parallel decimal
dollar input is embedded in code.

Every budget is alert-only:

- actual spend: 50%, 80%, 100%;
- forecasted spend: 100%;
- no automatic shutdown, quota change, or resource mutation.
