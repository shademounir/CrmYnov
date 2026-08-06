# Runbook — GCP bootstrap Phase 0

## Guardrails

This runbook is documentation only. CRMY-108 authorizes no plan or apply.

## Pre-apply sequence

1. Obtain Product Owner authorization with a fixed execution window.
2. Confirm the active account and organization `1046537507934`.
3. Confirm capacity to create four projects and global availability of all four
   approved project IDs.
4. Grant the temporary folder-creation permission and record its expiry.
5. Inject the full billing account ID from a secure local source. Do not echo it.
6. Resolve and approve real USD budget amounts. Do not convert the provisional
   MAD figures implicitly.
7. Run static checks, then a human-reviewed plan in a later authorized change.
8. Apply Foundation, validate billing and APIs, then apply the state root.
9. Migrate state to GCS before Phase 1.

Stop on any unexpected project, policy, currency, permission, quota, or billing
result. Do not retry by broadening IAM.
