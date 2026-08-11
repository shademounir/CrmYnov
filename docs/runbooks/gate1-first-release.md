# Runbook — first technical Gate-1 release

## Scope

This one-time bootstrap exception applies only to the first technical Gate-1
release. It does not authorize an application release, a Google Cloud change,
or automatic promotion.

The original prerelease `v0.1.0-gate.1` is retained as the failed published
attempt and must not be rewritten, moved, or republished. A corrected attempt
uses `v0.1.0-gate.2` only after separate Product Owner authorization.

## Bootstrap constraint

`main` does not yet contain `main-release-gate.yml`. GitHub evaluates a
`pull_request` workflow from the base branch, so the first release PR to `main`
cannot rely on this new workflow before it is merged. Existing `main`
protections, manual Product Owner review, `po-approved`, a non-Draft PR, green
checks already available from trusted branches, resolved conversations, and a
manual merge remain mandatory.

This exception ends immediately after the first manual merge containing the
workflow.

## Future authorized sequence

1. Generate a schema-2 manifest from the exact reviewed `develop` SHA with
   profile `gate-1` and version `v0.1.0-gate.1`.
2. Review and commit that manifest on `release/v0.1.0-gate.1`.
3. Open a manual release PR to `main`; do not configure auto-merge.
4. The Product Owner reviews the entire diff, leaves all PO-only actions
   manual, adds `po-approved`, marks Ready, and merges manually.
5. The `push` trigger runs `unit-tests`, `terraform-static`, `iac-security`,
   and `secret-scan` on the exact new `main` SHA.
6. Do not create a tag or GitHub Release unless all four checks are present,
   completed, successful, and attached to that exact SHA.
7. After the first reliable green run, add those exact GitHub Actions checks
   (App ID 15368) to `main` protection with `strict=true` in a separately
   authorized change. Preserve every other protection.
8. Only after those proofs may the Product Owner separately authorize the
   manual tag and GitHub Release.

Before publication, follow the repository auto-merge evidence procedure in
`docs/runbooks/release-process.md`. Prefer the explicit GitHub API value. If
the minimally scoped token omits it, the Product Owner may provide the four
short-lived repository variables bound to the exact release commit. An API
value of `true` is always blocking, and the release PR must report
`auto_merge: null`.

No step creates a GCP credential, authenticates to GCP, or runs Terraform
`plan`, `apply`, `destroy`, or `import`.

## Failure and rollback

If any post-merge check is missing, pending, cancelled, stale, attached to a
different SHA, or unsuccessful, stop before tagging. Open a normal revert PR
to `main`, repeat the same manual solo-owner review, and merge the revert only
after its available checks are green. Never reset, rebase, amend, or force push
protected history.

## Application-release gate

The Gate-1 profile cannot be reused to claim application readiness. Application
release remains blocked until lint, type-check, build, CodeQL,
dependency-review, container scanning, and SonarQube Quality Gate exist and are
reliably enforced.
