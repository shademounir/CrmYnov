# Runbook — Terraform service account impersonation

1. Authenticate the approved human account interactively.
2. Verify the account has only `serviceAccountTokenCreator` on `tf-bootstrap`.
3. Set the provider's `impersonate_service_account` input through an untracked
   execution variable; do not create an account key.
4. Verify the short-lived credential audience, expiry, and principal in a
   read-only call.
5. Run Terraform only within the approved change window and against the exact
   root and backend.
6. Clear process-scoped variables after execution.

This procedure applies only after the initial Foundation and state migration
have been completed and validated. The WIF/security root is excluded:
`tf-bootstrap` must never impersonate an administrator or execute a root that
grants its own permissions. That root is executed by the authorized temporary
institutional human or a distinct, pre-existing approved administrator identity.

Do not use application-default credentials unless a separate decision enables
them. ADC was absent during Gate -1 and was not activated.
