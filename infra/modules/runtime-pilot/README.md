# Canonical isolated STAGING/PROD pilot runtime

This shared module serves only the two roots under `infra/environments/staging`
and `infra/environments/prod`; DEV/Foundation/BST remain unchanged. Read each
root's ownership, budget adoption and backend prerequisites before use.

The profile deliberately matches the authorized small DEV pilot: PostgreSQL17
shared-core/ZONAL, direct private VPC egress, Cloud Run zero minimum instances
and independent persistent storage. This is not HA, an SLA or a spending cap.
No project, billing association, state bucket, WIF provider, DNS, load balancer,
seed, import or automatic job execution is created here.

Separate identities cover Web, API, operational jobs, migration/grants and
Scheduler. Only the migrator reads the migration URL; the runtime role must
be bounded by the compatible grant job before opening the API. The explicit
database/environment/project triplet is verified by that job before SQL writes.
Images must be qualified compatible digests promoted byte-identically into
the canonical target registry, not mutable tags or references to DEV.

All six ingestion flags default to literal OFF in API and ordinary jobs. The
append flow has independent storage, runtime, activation and Scheduler gates.
Its dedicated private bucket has public access prevention, versioning,
retention and `prevent_destroy`; payloads are uploaded outside Terraform and
their basenames must include the exact pinned SHA-256. API and the isolated
worker mount it read-only. They may impersonate only the dedicated Google
Sheets reader; no key is emitted. The worker uses a separate Cloud Run job and
Scheduler identity, while the follow-up Scheduler remains independent. Both
Schedulers default PAUSED. Unpausing append additionally requires a recorded
successful real observation. Gmail/recovery default OFF; no long-lived key is emitted. Target OAuth
consent, pinned numeric secrets, sender/origin and actual email receipt are
separate operational qualifications. Inbound and recording require verification
of the application's fresh disabled configuration, not a fictitious env flag.

Generated database credentials and the independent encryption key are private
state/Secret Manager data. Outputs expose only identifiers, URIs and digests.
Use the protected remote backend and treat saved plans/state as secrets.

Validate without cloud using the committed provider locks, `terraform init
-backend=false -lockfile=readonly`, `terraform validate` and
`node --test infra/tests/runtime-pilot-isolation.test.mjs`. Source-contract
tests do not substitute a target plan, IAM qualification, migration, restore,
alert receipt or deployment smoke.

The required order is: apply storage/identities only; upload and independently
verify boundary, qualification and allowlist objects; apply runtime with append
still OFF and Scheduler PAUSED; register/reconcile through the official API;
activate with Scheduler still PAUSED; execute and verify one real run; finally
set the observation gate and unpause. Rollback pauses Scheduler and disables
append without deleting the bucket, ledger, receipts, cursor or database rows.
