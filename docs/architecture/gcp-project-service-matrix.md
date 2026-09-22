# Project, service, and API matrix

| Project | Phase 0/1 APIs described | Runtime state on 22 September 2026 |
|---|---|---|
| Bootstrap | Resource Manager, Cloud Billing, Billing Budgets, Service Usage, IAM, IAM Credentials, STS, Cloud Storage | None |
| DEV | Service Usage, IAM, IAM Credentials | VPC, Artifact Registry, private Cloud SQL, Secret Manager, Cloud Run jobs and a paused Scheduler are provisioned. Web/API services remain gated until the reviewed SHA is integrated. The Terraform-state bucket is not business storage. The candidate-document bucket belongs to CRMY-90 and Pub/Sub transport belongs to CRMY-87; neither is provisioned empty by CRMY-30. |
| STAGING | Service Usage, IAM, IAM Credentials | Same categories, isolated from DEV and PROD |
| PROD | Service Usage, IAM, IAM Credentials | Same categories, isolated and human-approved |

Identity Platform remains a future architectural option and is not enabled by
CRMY-108.
