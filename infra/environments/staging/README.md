# STAGING isolated pilot runtime — CRMY-28

This root targets only `crmynov-stg-n7x4q2/europe-west1`. It reads the already
created canonical project through `data.google_project`; it never creates,
reparents or relinks a project, and never touches DEV or the Bootstrap state.
Project/billing/parent ownership belongs to the separately reviewed metadata
bootstrap. The two roots share `infra/modules/runtime-pilot`; DEV is unchanged.

## State ownership before any real initialization

Proposed bucket: `crmynov-runtime-tfstate-stg-n7x4q2`, owned in this target
project by the separate metadata bootstrap, prefix `runtime/staging`.
The example is not proof that the bucket exists or is authorized. Verify its
project owner, versioning, uniform access, public-access prevention, protected
deletion, bounded consumers and independent backups before initializing.
Never use the DEV/BST bucket, a local execution state, migrate existing state,
or import useful existing resources automatically. Inspect the actual backend
binding before every plan. Do not apply the legacy global Foundation root to
provision only this target.

After that independent review, initialize with the exact reviewed backend file:
`terraform init -input=false -lockfile=readonly -backend-config=PRIVATE_REVIEWED_BACKEND_FILE`.
No plan/apply or cloud action is authorized by this source change alone.

The USD150 project budget may already be owned by the explicit metadata
bootstrap. Before the first plan, adopt that SAME known native budget into
`module.runtime.google_billing_budget.runtime` with an explicitly reviewed
`terraform import` using its exact `billingAccounts/.../budgets/...` ID.
Never create a second budget or import by guessed name. Preserve the original
creation receipt and inspect the adoption plan; an intended budget replacement,
deletion or duplicate creation is a NO-GO. The runtime thereafter owns this
budget and its target-local operations channel; metadata bootstrap must not
manage the same budget concurrently. Billing association remains external.

## Deployment boundary

1. Private billing ID and authorized alert mailbox are required. Empty images
   and `deploy_services=false` describe the isolated foundation only.
2. Promote the already qualified compatible API/Web image bytes into the target
   registry, verify their identical immutable digests and scans; no tag or
   cross-environment image URI is accepted. Initial Cloud Run smoke may leave
   the origin empty ONLY with Gmail/recovery OFF; then pin the actual reviewed
   native URI before enabling either mail pathway. This initial module accepts
   only the exact URI of its own Web service (checked against the actual value),
   not another environment or a custom domain. DNS/TLS routing is a separate
   reviewed delivery, not inferred from GCP access.
3. Provision jobs with the API digest; execute migrate then grant only under a
   separately verified maintenance contract. Grant verifies
   `CRM_RUNTIME_DATABASE_NAME=crmynov_stg`,
   `CRM_RUNTIME_DATABASE_ENVIRONMENT=staging`,
   `CRM_RUNTIME_DATABASE_PROJECT=crmynov-stg-n7x4q2`. The API and due job cannot
   read the migration secret; its dedicated migrator identity can.
   No seed/reset/import is present.
4. Open compatible services only after target migrations, grants and smoke
   checks. Gmail/recovery default OFF; Gmail requires target-local numeric
   secret versions and separate sender/OAuth qualification, never copied values.
5. The follow-up Scheduler is created PAUSED. This version cannot unpause it.
   Activation requires a reviewed follow-up change and actual idempotence/target
   qualification. All six ingestion flags stay literal false in API and jobs.

No Sheets job/API, SIP profile, telephony provider, inbound listener or audio
storage is provisioned. Inbound/recording remain disabled by the application's
fresh configuration and agent contract; resource creation alone is not a proof
of their live settings. Verify the actual target configuration before use.

The public Web BFF alone invokes the IAM-private API. Network, database,
service accounts, secrets, encryption key, state and alert channel are isolated.
Secret payloads are generated into the private Terraform state/Secret Manager,
never outputs or examples. Treat saved plans and state as private credentials.

## Cost, protection and delivery reserves

The separately authorized monthly alert is USD150 for THIS target, at
50/80/100% CURRENT_SPEND and 100% FORECASTED_SPEND, monthly/all credits.
It does not cap spending. The requested DEV-like pilot profile is PostgreSQL17
Enterprise `db-f1-micro`, ZONAL, 10GiB SSD/autogrow, private TLS, daily backup
and seven-day PITR; shared-core is NOT HA or an SLA/RPO/RTO commitment. Region
pricing, usage, storage growth, build/registry/monitoring and any later domain
routing costs still require a reviewed objective dossier. This module does
not provision a load balancer, VPC connector, DNS or TLS mapping.

Cloud SQL has native deletion protection AND Terraform prevent_destroy.
Other useful stores/secrets/budget are protected too. Rollback is forward-
compatible images with preserved schema/data/history, never automatic database
restore or state removal. Alert creation is not confirmed email receipt.
WIF is not configured or certified here; an optional existing canonical deploy
service account receives only explicit target bindings, without key/provider.
The separate production GO/NO-GO and operational evidence remain required.
