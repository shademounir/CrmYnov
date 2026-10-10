# Immutable runtime promotion: STAGING and PROD pilot

This runbook prepares the authorized isolated pilot. It is not evidence that an
environment, administrator, delivery, e-mail transport, DNS record or import has
been created or validated. The initial monthly budget authorization is USD 150
per environment; a budget alert is not a spending cap. Use the current reviewed
plan and actual billing/IAM evidence before creating infrastructure.

## Identity and isolation

| Environment | Project | Database |
| --- | --- | --- |
| DEV | `crmynov-dev-n7x4q2` | `crmynov_dev` |
| STAGING | `crmynov-stg-n7x4q2` | `crmynov_stg` |
| PROD | `crmynov-prod-n7x4q2` | `crmynov_prod` |

Separate projects, Cloud SQL instances/databases, service identities, secrets,
storage, alerts and Terraform state. Do not copy the DEV database, credentials,
sessions, user activations or protected agent profiles into another environment.
Confirm native Cloud SQL deletion protection as well as Terraform protection,
backup/PITR settings, region, capacity and actual cost. A DEV-sized zonal instance
is a limited pilot, not a claim of HA or production SLA. Do not create replacement
projects or impersonate an identity to work around an IAM denial.

## Promote exactly the validated images

1. Record the protected integrated source SHA/tree, release/main SHA, published
   release and manifest. Require successful controls and authoritative policy
   proofs for those exact revisions, not an earlier branch or old PR.
2. Qualify API and Web Linux images by immutable registry digest, provenance,
   runtime/Node identity, non-root configuration and vulnerability results.
   Promote the same digest pair through STAGING and PROD; do not rebuild them per
   environment or deploy a floating tag. Runtime configuration supplies each
   environment's URLs, credentials and flags.
3. Start with producer jobs/Scheduler halted during initialization and all six
   automatic-entry flags explicitly `false`: `SHEETS_ENABLED`,
   `SHEET_CUTOVER_ENABLED`, `SHEET_ROW_APPEND_ENABLED`,
   `CRM_GOOGLE_SHEETS_ENABLED`, `CRM_SHEET_APPEND_POLICY_QUALIFIED`,
   `FORMINATOR_WEBHOOK_ENABLED`. External workers remain external. This does not
   authorize activation of Sheets, inbound telephony, recording or a real call.
4. Inspect current database identity, migration history/checksums and target
   state. With a fresh verified backup, stopped/drained producers and bounded
   connection/lock timeouts, run only the migrations actually pending in the
   qualified API image with the target's migrator secret. The source currently
   contains 52 migrations; this runtime-portability change adds none. Never run
   an old administrative job, seed, reset, reimport or restore as an upgrade.
   Keep execution/operation IDs; reconcile an uncertain result before a retry.
5. Execute the grant job once with the migrator connection and these explicit
   variables: `CRM_RUNTIME_DATABASE_ROLE=crm_runtime`,
   `CRM_RUNTIME_DATABASE_NAME`, `CRM_RUNTIME_DATABASE_ENVIRONMENT` (`dev`,
   `staging` or `prod`) and `CRM_RUNTIME_DATABASE_PROJECT` from the table.
   All three target values must match. If `GOOGLE_CLOUD_PROJECT` or
   `GCLOUD_PROJECT` is present it must also match. The job verifies
   `current_database()` before **any** privilege change and uses only three
   fixed quoted database identifiers. Missing target variables preserve only
   the old DEV launch, still checked against `crmynov_dev`; they never infer
   STAGING or PROD. A declared project is a configuration guard, not proof of
   the credential's Cloud SQL instance: bind the reviewed job/secret/instance
   independently. Preserve the runtime/migrator separation and the existing
   least-privilege grants, including denial of migration-history access.
6. Deploy the compatible API/Web pair. Configure the private API IAM audience
   and Web gateway, target database secret and exact HTTPS
   `CRM_PUBLIC_ORIGIN`; never derive invitation/CSRF origins from Host headers.
   Verify readiness/database, anonymous refusals, authenticated permissions,
   persistence and six flags OFF on the actual revisions. Re-enable only the
   separately authorized Scheduler after this verification. STAGING uses
   synthetic/anonymized data; real Excel and named invitations are PROD-only.

## Initial identities, references and e-mail

No automatic institutional administrator is provisioned by the migrations.
`seed-local.ts` is synthetic and resets credentials: **never run it on PROD**.
The first administrator needs a separately reviewed, target-bound, audited,
one-shot provisioning operation and an explicitly authorized identity; this
runbook does not implement or claim that bootstrap. Do not promote Mounir or a
Director to Super Admin as a workaround. Existing user/invitation APIs require
an activated Super Admin with effective current grants.

Before creation, inspect the target's existing identities and preserve them.
Reuse the authorized Mounir identity if present, without resetting activation,
duplicating it or widening its role. Match the seven authorized named accounts
to their approved identities, roles and campus scopes. Create/reuse Casablanca
Ynov Campus and equivalent campaign references instead of duplicate labels;
residence city/country is not the campus. Unknown cycle/program/level stays
unknown under BASELINE. Historical owners are not randomly redistributed.

Configure a durable approved Gmail sender/client/consent and separate target
secret versions; DEV OAuth credentials or a Testing grant are not proof of
durable PROD operation. The existing DEV consent helper is project/mailbox
specific and must not be executed against PROD unchanged. Keep the minimal
scope, tokens private and provider response data out of logs. Validate the
stable HTTPS origin before sending links. The chosen CRM subdomain requires
authorized DNS control and verified TLS; preserve the main website, NS, MX and
mail records. Cloud Run HTTPS reachability alone does not prove that DNS or
institutional mail is ready.

Prove transport and activation with authorized synthetic recipe identities
before sending named PROD invitations. An accepted Gmail request is not proof
of reception. Record reception, definition of a password and fresh login
separately. Each activated user must receive navigation and API access matching
current server permissions. Do not mark `firstLoginRequired=false` merely to
make an import or Admissions responsibility eligible: both require actual
activation, correct campus and effective capabilities. Pending owners can remain
explicitly unresolved/deferred while independent preparation continues.

Direction is not a technical role. The current model has one campus per
collaborator and several reporting/Admissions queries grant cross-campus scope
only to Super Admin. Therefore a GLOBAL grant alone does not establish a normal
Director's multi-campus access. A Casablanca-only ADMIN/MANAGER pilot may use
explicit grants and Admissions responsibilities; true delegated multi-campus
access remains a separate verified requirement, not an automatic elevation.

Agents use the target's HTTPS Web `/agent/` gateway, compatible version and a
fresh target-bound pairing. Preserve protected local profiles, but do not
reuse DEV tokens or silently carry its telephony encryption key into PROD.
Inbound audio, recording and real calls remain disabled/unperformed unless
separately authorized. The agent's current Cloud Run label may say DEV; that
label is not evidence of environment identity.

## Import, T0 and rollback limits

Amorçage uses the approved frozen Excel, mapping, owner identities and durable
occurrence dispositions qualified on synthetic/anonymized data first. Real
import and named invitations remain PROD-only. Do not load a local/DEV dump into
PROD. Preserve exact comments/provenance, unknown values, review/quarantine and
idempotency receipts. Verify persisted reconciliation and interruption/replay
before claiming completion. Sheets stays OFF until its separate durable T0,
bootstrap/disposition coverage, catch-up and producer contract are qualified.
The real boundary exceeds Secret Manager's 64 KiB value limit: a future
authorized read-only private artifact mount is required, never Git, image,
environment variable or real data in STAGING/DEV.

Keep the prior compatible API/Web digests, configuration snapshot and exact
database backup references. Before an application rollback, verify schema,
BASELINE/deferred receipts and all later writes are understood by that version.
Do not return to a vulnerable legacy version. Active Admissions reservations or
DEFERRED inventories can make an older runtime unsafe even when SQL is additive.
Preserve the additive schema and ledgers; stop the affected producers rather
than purge history or restore over subsequent writes. A dump readable with
`pg_restore --list` is not a tested restoration. Document a separately isolated
restore exercise and the actual recovery time before claiming it operational.

Open prerequisites remain explicit: project/billing/IAM access, initial admin
identity/provisioning, actual costs, backup/restore proof, received alerts,
durable sender/consent, DNS/TLS authority, named-user activations and any required
Direction multi-campus behavior. None is acquired by a successful Terraform
plan, migration, image scan or this runbook alone.
