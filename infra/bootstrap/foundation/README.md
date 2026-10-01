# Phase 0 — Foundation

This root module describes the future `CRM Ynov` folder, the three environment
projects, their billing associations, complementary APIs, and five alert-only
budgets. The fourth approved project, `crmynov-bst-n7x4q2`, is an external
dependency owned by the dedicated Phase 0 state (ADR-0006); this root reads it
and never recreates, imports, owns, or relinks it.

It deliberately has no backend block. The first authorized execution uses a
temporary local state and is run by the authorized temporary institutional
human. That human creates and validates the state buckets through the separate
`state` root, then migrates immediately to GCS under human control. Only after
the migration and identity validation may later Foundation operations
impersonate `tf-bootstrap`.

## Preconditions before any plan or apply

- temporary `resourcemanager.folderCreator` access is granted and time-boxed;
- Phase 0 is complete and its redacted proof is approved;
- capacity for three project creations is confirmed;
- each environment project ID is confirmed globally available;
- the full billing ID is injected through a secure, untracked variable;
- the Product Owner approves real USD amounts because the billing account is
  denominated in USD and no MAD conversion is encoded;
- the human Owner exception and its 24-hour expiry are recorded.

No `plan`, `apply`, or GCP mutation is authorized by this repository change.

## Budget input contract

Foundation budgets use `budget_amount_cents` exclusively. The approved values
are 833 (Bootstrap), 4167 (DEV), 3333 (STAGING), 10000 (PROD), and 18333
(aggregate folder). The aggregate must exactly equal the four project budgets.
The previous `budget_amounts` decimal-dollar input has been removed; callers
must migrate to integer cents before a future separately authorized plan.
