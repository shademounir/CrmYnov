# ADR-0004 — GitHub Actions WIF strategy

- Status: Accepted for code preparation

## Decision

Use GitHub's official OIDC issuer and no persistent JSON key. Create separate
providers and deployment service accounts for DEV, STAGING, and PROD.

Every CEL condition binds:

- repository `shademounir/CrmYnov`;
- repository ID `1313619083`;
- repository owner ID `151538330`;
- the exact branch policy;
- the protected GitHub Environment.

DEV accepts only `develop` with `DEV`; STAGING accepts `release/*` with
`STAGING`; PROD accepts only `main` with `PROD`, and the PROD GitHub Environment
must require manual Product Owner approval. Repository ID and owner ID make
forks fail closed even when names resemble the official repository. Workflows
receive only `contents: read` and `id-token: write` for authentication steps.
