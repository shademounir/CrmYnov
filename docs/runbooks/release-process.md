# Runbook — Human-validated release process

## Principle

Merging a functional pull request into `develop` does not complete a Jira
ticket. The ticket remains In Review until a release is reviewed, merged into
`main`, tagged, and published with an integrity-checked manifest.

The current workflows only prepare evidence and simulate Jira decisions. They
do not create a tag, GitHub Release, release branch, or Jira transition.

## Release manifest

`release-prepare.yml` is a manually dispatched, read-only workflow. It requires:

- a semantic version;
- an explicit `gate-1` or `application` profile;
- the full candidate commit SHA;
- an explicit comma-separated list of CRMY ticket keys.

The manifest generator sorts and deduplicates ticket keys and adds a SHA-256
integrity digest. `targetCommit` is the reviewed source commit from `develop`;
it is not the future squash commit on `main`. The artifact must be reviewed and
committed as `release-manifest.json` in a future `release/<version>` branch
through a pull request to `main`.

The technical Gate-1 prerelease version is `v0.1.0-gate.1`. The parser accepts
that version without creating a tag. Manifest schema 2 includes the selected
profile in its integrity digest, so the required-check list cannot be changed
without invalidating the manifest.

## Release profiles

The narrowly scoped `gate-1` profile is limited to controls that exist today
and run without credentials:

- `unit-tests`;
- `terraform-static`;
- `iac-security`;
- `secret-scan`.

The `application` profile remains fail-closed and additionally requires
`lint`, `type-check`, `build`, `CodeQL`, `dependency-review`,
`container-scan`, and `SonarQube Quality Gate`. Those controls are not claimed
as available by this technical release. Any application release attempted
before they exist will fail because required checks are absent.

## Required human sequence

1. Confirm every included functional PR is merged into `develop`, reviewed, and
   green.
2. Generate the manifest from the exact candidate SHA.
3. Review the manifest for ticket scope and absence of personal or sensitive
   data.
4. Open a release PR from `release/<version>` to `main`. This is a separate
   future authorization; the current preparation PR targets only `develop`.
5. The Product Owner reviews the diff, acceptance criteria, tests, risks, and
   rollback, completes the PR checklist, adds `po-approved`, and marks the PR
   ready for review manually.
6. The Product Owner merges the release PR manually without bypassing
   protection. Codex and GitHub Actions must never perform these actions.
7. Confirm the four Gate-1 checks completed successfully on the exact resulting
   `main` SHA. For the first technical release, follow the bootstrap procedure
   in `docs/runbooks/gate1-first-release.md`.
8. Only then create the tag on the exact manifest commit.
9. Publish the GitHub Release manually.
10. Let `release-publish.yml` prove:
   - the release was published by the authorized actor;
   - the tag commit is in `main`;
   - the tagged commit is associated with a human-merged release PR to `main`;
   - `RELEASE_APPROVAL_MODE` is exactly `solo-owner`;
   - the release PR is non-Draft, authored and merged by an allowlisted actor,
     carries `po-approved`, has no auto-merge request, and repository auto-merge
     is disabled;
   - the manifest source commit belongs to that release PR, including when the
     PR was squash-merged;
   - every explicitly required check is present, completed, and successful;
   - the tag and commit match the manifest;
   - each Jira ticket is listed in that manifest.
11. Review the dry-run output. No Jira mutation is currently permitted.

## Refusal conditions

The Jira Done plan is refused when any evidence is missing, the ticket is not
In Review, the ticket lacks `codex-ready`, it is blocked, or its type is Epic.
A closed or merged functional PR is never sufficient evidence for Done.

The required check list is selected from the integrity-checked manifest
profile. An empty profile list, unsupported profile, missing check, pending
check, failed check, or check attached to a SHA other than the exact release
commit refuses validation. A Draft or unmerged release PR, a base other than
`main`, configured auto-merge, missing `po-approved`, absent ticket, or Epic
closure is also refused.

Check runs are retrieved with `per_page=100` until `total_count` is reached.
Missing pages, missing checks, pending checks, cancelled checks, and any
conclusion other than `success` refuse Jira completion. Additional checks do
not block the release.

`RELEASE_APPROVAL_MODE` is also mandatory and must equal `solo-owner`. A
missing value, any other value, a Draft release PR, a missing `po-approved`
label, an unauthorized author or merger, or auto-merge evidence refuses Jira
completion.

## Public repository protections

Release manifests contain ticket keys and commit identifiers only. They must
not contain applicant data, telephone configuration, endpoint credentials,
tokens, internal hostnames, or environment values.

The release workflow:

- is triggered from trusted release metadata, not `pull_request_target`;
- uses only `contents: read`, `checks: read`, and `pull-requests: read`; all
  unspecified token permissions remain `none`;
- checks out the immutable published tag;
- persists no checkout credentials;
- does not create a tag or release;
- does not create, add, or remove `po-approved`;
- does not mark a PR ready, merge a PR, or enable auto-merge;
- keeps Jira synchronization disabled and in dry-run mode.

## Rollback

Before publication, close the release PR or discard the generated artifact.
If the first post-merge Gate-1 run on `main` fails, do not tag or publish. Open
a normal Product Owner-reviewed revert PR against `main`; never reset or force
push protected history.
After an erroneous GitHub Release publication, mark or delete the release only
through a separate human-approved operational decision; do not rewrite Git
history. Keep Jira unchanged while dry-run is active.

If a future active synchronization completes an incorrect ticket, disable the
sync, revoke the Jira token, inspect the audit log, and request a Jira
Administrator to decide whether the controlled `Réouvrir` transition is
appropriate.
