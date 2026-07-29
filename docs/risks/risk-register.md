# Risk register

## R-SOLO-001 — No four-eyes review on pull requests

- Context: the project is developed and governed by one Product Owner, with
  Codex acting as a development agent under the same GitHub account.
- Impact: an implementation or governance error may be accepted without an
  independent human detecting it.
- Accepted scope: bootstrap, development, MVP, DEV, and STAGING.
- Compensating controls:
  - Codex never merges;
  - manual Product Owner validation;
  - reserved `po-approved` label;
  - mandatory checks;
  - SonarQube Cloud and CodeQL;
  - automated tests and security scans;
  - retained PR and CI history;
  - manual releases;
  - documented rollback.
- Acceptance: Product Owner arbitration dated 29 July 2026.
- Review trigger: before PROD is opened to real data.
- PROD status: not accepted; a second reviewer requirement must be reassessed.

## R-BOOT-002 — Required branch checks not yet registered

- Context: the target branches do not yet contain a shared baseline workflow,
  and GitHub has no required status-check context to register.
- Impact: PR and conversation protections apply, but GitHub does not yet enforce
  a named CI check or strict up-to-date status at branch-protection level.
- Mitigation: keep PRs Draft; require manual CI review; do not merge until the
  expected run is green; register the exact trusted check names immediately
  after the bootstrap workflow lands.
- Rollback: remove an incorrectly registered context through the branch
  protection API; never bypass protection to work around a wrong name.
- Owner: Product Owner.
- Status: open bootstrap risk; not accepted for PROD.
