# CI quality and security gates

## Scope

Pull requests to `develop` run independent lint, type-check, unit, integration,
targeted E2E, build, dependency review, SBOM, secret, container-readiness,
SonarCloud, CodeQL, and Terraform IaC checks. `quality-gate` aggregates all the
application jobs with `if: always()` and fails unless every dependency succeeds.

The current repository contains JavaScript automation only. The root lint and
type-check commands validate every versioned `.mjs` module with the Node parser;
CRMY-32 must replace or extend those commands with the locked TypeScript and
workspace tooling when Next.js and NestJS are introduced.

## SonarCloud activation

`sonar-project.properties` contains only repository-local analysis settings; it
does not invent or expose a SonarCloud identity. SonarCloud is intentionally
fail-closed until the Product Owner configures all
of the following Repository Actions settings:

- non-secret variable `SONAR_ORGANIZATION`;
- non-secret variable `SONAR_PROJECT_KEY`;
- Actions secret `SONAR_TOKEN`.

The organization and project must first be created in SonarCloud and the GitHub
repository bound to that project. Values must never be guessed or committed.
The scan passes the organization and project key at runtime, waits for the
remote Quality Gate, and cannot be reported green until that gate returns
success.

## Security boundaries

- Workflows use `pull_request`, never `pull_request_target`.
- Forks and non-owner actors are rejected before checkout.
- Checkout credentials are never persisted.
- Actions are pinned to full commit SHAs.
- Default permissions are `contents: read`; only CodeQL receives the justified
  `security-events: write` permission required for SARIF upload.
- No Jira mutation, cloud credential, GCP command, deployment, or Terraform
  mutating command is present.
- The SBOM contains package metadata only and is retained for seven days.

## Container hand-off

No application image exists before CRMY-32. The `container-scan` job records
that state. As soon as a Dockerfile appears it fails closed, forcing the same PR
to add a locked image build and pinned Trivy image scan before merge. A skipped
container scan is therefore not silently accepted once images exist.

## Rollback

Use a protected revert PR for the CRMY-33 squash commit. Do not disable branch
protection, delete security evidence, or rewrite `develop` history. If only
SonarCloud is unavailable, keep its job red and correct the repository settings;
do not weaken or remove the aggregate gate.
