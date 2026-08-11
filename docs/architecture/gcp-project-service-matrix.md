# Project, service, and API matrix

| Project | Phase 0/1 APIs described | Phase 2 resources, not implemented |
|---|---|---|
| Bootstrap | Resource Manager, Cloud Billing, Billing Budgets, Service Usage, IAM, IAM Credentials, STS, Cloud Storage | None |
| DEV | Service Usage, IAM, IAM Credentials | VPC, Artifact Registry, Cloud Run, private Cloud SQL, document bucket, Secret Manager, observability |
| STAGING | Service Usage, IAM, IAM Credentials | Same categories, isolated from DEV and PROD |
| PROD | Service Usage, IAM, IAM Credentials | Same categories, isolated and human-approved |

Identity Platform remains a future architectural option and is not enabled by
CRMY-108.
