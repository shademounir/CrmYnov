# Google Cloud IAM matrix

| Principal | Scope | Intended roles | Prohibited |
|---|---|---|---|
| Temporary human bootstrap owner | Organization/project bootstrap window | Basic Owner, maximum 24 hours by explicit exception | Silent extension, service-account use |
| `tf-bootstrap` | CRM folder | Project Creator | Organization-wide basic roles |
| `tf-bootstrap` | Four projects | Service Usage Admin, Project IAM Admin, Service Account Admin | Owner, Editor |
| `tf-bootstrap` | Bootstrap project | WIF Pool Admin, Storage Admin | Business runtime access |
| `tf-bootstrap` | Billing account | Billing User | Billing administrator unless separately approved |
| GitHub DEV deploy | DEV service account | WIF impersonation only in Phase 1 | STAGING/PROD token, feature/fork token |
| GitHub STAGING deploy | STAGING service account | WIF impersonation only in Phase 1 | DEV/PROD token, non-release branch token |
| GitHub PROD deploy | PROD service account | WIF impersonation only in Phase 1 | Non-main token, unapproved Environment token |
| Future frontend runtime | One environment | Phase 2 roles defined per resource | Backend, migration, cross-environment access |
| Future backend runtime | One environment | Phase 2 roles defined per resource | Frontend, migration, cross-environment access |
| Future migrations identity | One environment | Time-bound database migration rights | Continuous runtime use |

The Phase 1 code creates no JSON key and assigns no deployment runtime role.
Phase 2 must add resource-level roles only after the corresponding resources and
threat model are reviewed.
