# Phase 1 — IAM, impersonation, and GitHub WIF

This root describes a keyless `tf-bootstrap` identity, three separate GitHub
deployment identities, and three fail-closed WIF providers hosted in the
bootstrap project.

Access policy:

- DEV: exact repository and numeric IDs, `develop`, GitHub Environment `DEV`;
- STAGING: exact repository and numeric IDs, `release/*`, Environment `STAGING`;
- PROD: exact repository and numeric IDs, `main`, Environment `PROD`; that
  GitHub Environment must require manual Product Owner approval;
- forks, feature branches, different owners, and different repositories fail
  the CEL condition and cannot exchange a token.

GitHub workflows must use only `contents: read` and `id-token: write`. No JSON
service account key is created by this configuration.
