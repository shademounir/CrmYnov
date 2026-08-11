# Google Cloud naming conventions

| Resource | Convention | Example |
|---|---|---|
| Project | `crmynov-<perimeter>-n7x4q2` | `crmynov-stg-n7x4q2` |
| State bucket | `crmynov-tfstate-<perimeter>-n7x4q2` | `crmynov-tfstate-prod-n7x4q2` |
| GitHub deploy SA | `gh-deploy-<environment>` | `gh-deploy-staging` |
| Terraform SA | `tf-bootstrap` | `tf-bootstrap` |
| WIF pool/provider | `github-<environment>` | `github-prod` |

Names contain no person, applicant, email address, telephone number, or secret.
