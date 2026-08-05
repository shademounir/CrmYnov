# Phase 0 — Foundation

This root module describes the future `CRM Ynov` folder, the four approved
projects, billing associations, strictly required APIs, and alert-only budgets.

It deliberately has no backend block. The first authorized execution uses a
temporary local state, creates and validates the state buckets through the
separate `state` root, then migrates immediately to GCS under human control.

## Preconditions before any plan or apply

- temporary `resourcemanager.folderCreator` access is granted and time-boxed;
- capacity for four project creations is confirmed;
- each project ID is confirmed globally available;
- the full billing ID is injected through a secure, untracked variable;
- the Product Owner approves real USD amounts because the billing account is
  denominated in USD and no MAD conversion is encoded;
- the human Owner exception and its 24-hour expiry are recorded.

No `plan`, `apply`, or GCP mutation is authorized by this repository change.
