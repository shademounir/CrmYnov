# Google Cloud infrastructure — Gate -1

The Terraform tree is code-only and covers Foundation and Security. It does not
authorize or perform Google Cloud mutations.

## Roots

1. `bootstrap/phase0`: adoption of the preexisting bootstrap project, its billing link, and three imported minimal APIs.
2. `bootstrap/foundation`: folder, three environment projects, complementary APIs, and five budgets.
2. `bootstrap/state`: four private and independent Terraform state buckets.
3. `bootstrap/wif`: IAM, impersonation, service accounts, and GitHub OIDC.

Run them only in that order after a separate Product Owner authorization. The
`environments/*` directories document Phase 2 but contain no runtime Terraform.

## Local validation only

```powershell
terraform fmt -check -recursive infra
npm run test:terraform
```

Initialization for validation uses `terraform init -backend=false`. No plan or
apply is part of this change.
