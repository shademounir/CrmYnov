# CRMY-176 — association generation rollback

This additive nullable UUID has no default, data backfill, new uniqueness constraint or historical rewrite. Existing associations remain NULL and cannot use machine withdrawal until an explicit authorized pairing creates a generation. Migration qualification must run on an isolated ephemeral PostgreSQL database before any deployment.

## Deployment and locks

Take and verify the target database backup through the established release procedure. Check active operations before migration. ADD COLUMN requires a short exclusive table lock even without a row rewrite; the operator must apply the existing bounded lock/statement timeout procedure and stop on lock contention, not terminate another transaction or force a migration lock. No migration or restore has been executed merely by adding these files.

## Application rollback

Keep the column, association values and all withdrawal audit receipts. Prefer a forward application repair. Do not remove the column, mutate audit events or edit Prisma migration history. A version predating generation-aware pairing must not serve pairing/withdrawal traffic after generation values exist: it would rotate a token without rotating association_id. Suspend those routes or retain the compatible application while rolling back unrelated behavior. Existing associations and SIP profiles must not be reconstructed automatically.

Withdrawal disables only the exact workstation and its individual user profile. Restoring service requires the authorized provisioning/pairing workflow and a fresh generation; an old receipt must never clear the newly paired local settings. The shared server profile, users, calls, event journal and audit history are retained. No database restoration or automatic re-pairing is part of rollback.

## Evidence still required

Exact-SHA CI must prove migration/schema parity, first withdrawal atomicity, read-only receipt replay after a lost response, association isolation, and concurrent permission/call fencing. An application append-only audit contract is not a claim of SQL-level immutability.
