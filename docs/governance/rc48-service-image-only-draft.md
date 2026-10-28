# RC48 service-image-only extension — unqualified draft

This candidate is not an operational authority or executable delivery. It has no
published PR, protected concrete runtime objective, qualified native preparation,
operational rollback/recoverability receipt, or completed source/native qualification.
Protected PR263 source is integrated at 0fa91b2524badb34cd5cd64d438a3f71ca6b9155.
This does not qualify or publish the new image-only extension.

Implemented local components:

- `plan.mjs`: exact RC48 API/Web digest targets, two `template.containers` image
  patches only, fixed existing service UID/revision, six ingestion flags OFF and
  external workers. Existing job/Scheduler configuration is not written. The
  inventory now requires exactly the 13 actually observed job names, UIDs and
  digests (native GET receipt 28 October, SHA256
  b045622f011f81335ed0146fce2e8eb8420d186954d026b4f5969e1b7f7d644b).
  No family-name fallback or additional job is accepted. Full current job
  configuration hashes still have to match the protected operational objective
  immediately before mutation; the observed inventory is not perpetually fresh.
- `journal.mjs`: exclusive fsynced per-stage intent, recorded operation, terminal
  native observation. Stages are BACKUP, API_IMAGE, WEB_IMAGE. An intent without
  an operation is UNKNOWN and cannot authorize a retry. Known operations may only
  be observed; FIN is not replayable. A corrupt/truncated/orphan record refuses.
- `served-state.mjs`: new Ready revision, digest and 100% latest traffic, same
  service UID and all service configuration unchanged except image and linked
  server-generated revision name. Native-origin authentication, HTTP serving,
  SQL preservation and Sheets activation are explicitly not asserted by this
  comparison of supplied metadata.
- `transport.mjs`: isolated narrow extension, unchanged existing READ ONLY
  transports/authentication bounds. It accepts only a distinct
  `RC48_SERVICE_IMAGE_ONLY_V1` authority, exact approved plan digest and existing
  account. It rechecks current authority after token await. Only fixed metadata
  GETs, the two plan-specific image PATCHes and an on-demand backup insert on the
  existing SQL instance are exposed. It does not itself issue authority, consume
  the journal, retry an unknown exchange, or prove provider origin.
- `authority.mjs` reuses the existing protected merge/source/delegation/Jira gates
  and requires an exact nonempty protected image objective, source-bound preparation,
  13-job and Scheduler hashes, plus a fresh plan-specific operational marker. No
  READ ONLY authority is upgraded; no Codex bot completion is required.
- The versioned `operational-driver-v2.mjs image-only` dispatch extends the
  narrow CLI. `plan` is pure and unqualified. `inspect` reads local journals only.
  `verify`, `backup`, `patch-api`, `patch-web` and the three `observe-*` modes are
  separate explicit steps; there is no apply-all loop, retry or default objective.
  Each mutation consumes a durable intent before its native request. Web requires
  a successful API FIN and current API metadata. Both patches require the actual
  successful fresh on-demand backup and unchanged jobs/Schedulers.
  The historical READ ONLY driver and its source/objective pins remain byte
  identical; old modes delegate to that existing entry without reimplementation.
- `preparation.mjs` requires the reviewed exact receipt bytes and seven distinct
  pinned evidence inputs: pool, ledger, general preservation, prospective
  permissions, job inventory, recoverability and compatible image-only rollback.
  These receipts have NOT yet all been qualified for this deployment; no local
  true flag or synthetic test receipt is operational authority.

Synthetic development observations are not final qualification. No provider
request, actual backup, service patch, runtime rollout, ingestion flag, business
Scheduler, mail configuration, installer, phone call or UI acceptance was acquired
by developing these modules. An initial transport syntax typo was found by Node
before execution and corrected in this unsealed draft.

Remaining operational work must bind actual protected source and fresh
Jira/grant/audit/decision/check IDs, a distinct concrete deployment objective,
current source-bound PRE proofs, the entire actual job/UID inventory, native
service UID/etag/template inventory, a fresh backup created only when ready and
recoverability evidence. The journal must be consumed before each single native
mutation; no automatic mutation retry is permitted. Then reconcile actual
operations, served revisions/digests, SQL and all untouched jobs/Schedulers.

Image-only control-plane requests do not mean zero SQL writes at API startup.
The unchanged permission catalogue startup path increments its technical epoch;
the actual existing permission keys and compatibility/preservation must be
checked before rollout. No implicit IAM/grant widening, SQL DDL/restore/reset,
historical pool-hash recovery, new baseline/cohort, retroactive assignment or mail
SEND/PREFLIGHT/configuration is authorized. Existing RC48 images must be reused;
old RC45 plan factories and Terraform shared-image fallbacks remain inadmissible.

A compatible image-only rollback remains a separate fresh qualified objective,
must preserve intervening writes and cannot be inferred to authorize rollback
after Sheets activation. Never restore the entire production database as an
image rollback.

Official API references inspected during development:

- [Cloud Run service PATCH](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/patch)
- [Cloud Run service fields and reconciliation](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services)
- [Cloud SQL on-demand backup insert](https://docs.cloud.google.com/sql/docs/postgres/admin-api/rest/v1beta4/backupRuns/insert)
- [Cloud SQL backup metadata](https://docs.cloud.google.com/sql/docs/postgres/admin-api/rest/v1beta4/backupRuns)
- [Cloud SQL operation metadata](https://docs.cloud.google.com/sql/docs/postgres/admin-api/rest/v1beta4/operations)
