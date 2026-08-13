# Phase 0 bootstrap — rollback runbook

## Code-only delivery

Before merge, close the Draft PR and delete only its feature branch. No GCP
rollback exists because this delivery must not contact Google Cloud.

## Future Phase 0 failure

Fail closed, stop all following phases, release the local attempt lock, retain
redacted evidence, and set `rollbackRequired=true` only when a cloud mutation
was observed. Never delete the Terraform state or project to hide a partial
result.

- Before project creation: no cloud rollback.
- Project created but billing/API incomplete: retain the project under
  `deletion_policy = "PREVENT"`, diagnose, and resume with the same Phase 0
  state after separate approval.
- Quota project configured locally: remove or replace that local ADC setting
  only through an explicitly authorized procedure; do not modify the ADC file
  manually.
- Project parent move fails: keep ownership in Phase 0 and restore the last
  approved parent through the same state after approval.

Project deletion, billing unlink, IAM changes, state removal, import, and
Terraform destroy are destructive or sensitive operations and each requires a
new Product Owner authorization. Foundation Phase 1 must never adopt the
bootstrap `google_project` as a rollback shortcut.
