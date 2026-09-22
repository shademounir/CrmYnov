# CRM Ynov DEV runtime

This root is restricted to `crmynov-dev-n7x4q2` in `europe-west1`. It never
manages STAGING or PROD. It provisions Artifact Registry, an isolated VPC,
private Cloud SQL, Secret Manager, Cloud Run Web/API/jobs and a Scheduler trigger
for due follow-ups. Scheduled Sheets remain disabled.

The API is protected by Cloud Run IAM. The public Web BFF retains the CRM session
in `Authorization` and uses `X-Serverless-Authorization` for Google service
identity. The Windows agent connects through the bounded Web `/agent/` gateway;
SIP credentials stay on the workstation.

The GCS backend is partial. Initialize only with the reviewed DEV state bucket:

```powershell
terraform init -backend-config="bucket=<reviewed-dev-state-bucket>" -backend-config="prefix=runtime/dev"
```

Do not apply with local state. Confirm versioning, public-access prevention,
retention and bounded state permissions first. Reuse the existing Bootstrap WIF
principal; do not create a replacement pool when Bootstrap access is unavailable.

Deploy in four fail-closed stages: (1) empty image variables for foundational
resources; (2) immutable `@sha256:` images with `deploy_services=false`; (3)
execute `crm-dev-migrate`, then `crm-dev-grant-runtime-database`, then the
idempotent synthetic seed; (4) set `deploy_services=true`, smoke-test Web/API,
then unpause the due-job Scheduler. The API always uses `crm_runtime`; only the
migration and grant jobs can read the `crm_migrator` URL. The seed password
remains in Secret Manager and must never appear in logs or reports.

The expected first deployment has Cloud Run scale-to-zero services and a zonal
`db-f1-micro`. At the prices reviewed on 2026-09-22, the database compute is
about USD 7.67/month before storage/backups; Cloud Run is usage-based and its
free tier can cover a lightly used DEV service. Reserve USD 25-60/month for the
pilot and keep the USD 150 budget alert as the hard approval boundary. Shared
core Cloud SQL has no SLA and is DEV-only.

Inspect every saved plan for replacement or destruction. Cloud SQL and Cloud Run
use deletion protection. Budgets alert but do not cap spending; budget management
stays disabled until the existing Foundation budget is reconciled.
