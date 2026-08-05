# ADR-0002 — Four-project separation

- Status: Accepted for code preparation

## Decision

Use exactly four projects:

| Perimeter | Project ID | Purpose |
|---|---|---|
| Bootstrap | `crmynov-bst-n7x4q2` | WIF, Terraform states, bootstrap IAM, budgets, audit controls |
| DEV | `crmynov-dev-n7x4q2` | Development runtime in Phase 2 |
| STAGING | `crmynov-stg-n7x4q2` | Pre-production runtime in Phase 2 |
| PROD | `crmynov-prod-n7x4q2` | Production runtime in Phase 2 |

Bootstrap must never contain business runtime, applicant documents, application
secrets, Cloud SQL, or CRM services. Project ID availability remains probable,
not guaranteed, until an authorized creation attempt.
