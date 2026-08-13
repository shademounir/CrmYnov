# Phase 0 bootstrap — rollback runbook

## Code-only delivery

Before merge, close the Draft PR and delete only its feature branch. No GCP
rollback exists because this delivery must not contact Google Cloud.

## Future Phase 0 failure

Fail closed, stop all following phases, release the local attempt lock, retain
redacted evidence, and set `rollbackRequired=true` only when a cloud mutation
was observed. Never delete the Terraform state or project to hide a partial
result.

- Before Phase 0A project creation: no cloud rollback.
- After Phase 0A but before import: retain the project, diagnose, and never let
  Foundation adopt it.
- Failed or partial Phase 0B import: stop before plan, preserve both project and
  state evidence, check all other states, and resume only with explicit import
  authorization. Never import the same project into another state.
- After Phase 0B: retain the project under `deletion_policy = "PREVENT"` and
  repair through the same Phase 0 state.
- API activated but not imported: stop before plan and import the exact service
  address after authorization; do not let Terraform claim it as a creation.
- Quota project configured locally: remove or replace that local ADC setting
  only through an explicitly authorized procedure; do not modify the ADC file
  manually.
- Project parent move fails: keep ownership in Phase 0 and restore the last
  approved parent through the same state after approval.

Project deletion, billing unlink, IAM changes, state removal, import, and
Terraform destroy are destructive or sensitive operations and each requires a
new Product Owner authorization. Foundation Phase 1 must never adopt the
bootstrap `google_project` as a rollback shortcut.
