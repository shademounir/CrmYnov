# Phase 1 — IAM, impersonation, and GitHub WIF

This root describes a keyless `tf-bootstrap` identity, three separate GitHub
deployment identities, and three fail-closed WIF providers hosted in the
bootstrap project.

## Execution identity

The first WIF/security execution is performed either directly by the authorized
temporary institutional human or by impersonating a distinct, pre-existing,
approved administrator identity through
`bootstrap_administrator_service_account_email`. `tf-bootstrap` must never be
used to execute this root or grant its own permissions; variable validation
rejects that self-administration path.

After Phase 1 is validated, future non-security roots may use `tf-bootstrap` or
the narrower Phase 2 Terraform identities approved for their perimeter. Changes
to WIF, IAM administration, or security bootstrap remain reserved for a distinct
approved administrator identity.

Access policy:

- DEV: exact repository and numeric IDs, `develop`, GitHub Environment `DEV`;
- STAGING: exact repository and numeric IDs, `release/*`, Environment `STAGING`;
- PROD: exact repository and numeric IDs, `main`, Environment `PROD`; that
  GitHub Environment must require manual Product Owner approval;
- forks, feature branches, different owners, and different repositories fail
  the CEL condition and cannot exchange a token.

GitHub workflows must use only `contents: read` and `id-token: write`. No JSON
service account key is created by this configuration.

The billing bindings are intentionally additive: `roles/billing.user` permits
project billing association and `roles/billing.costsManager` permits budget and
cost controls. Neither Billing Admin nor a basic Owner/Editor role is assigned.
