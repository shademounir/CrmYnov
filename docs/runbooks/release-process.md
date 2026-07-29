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
- the full candidate commit SHA;
- an explicit comma-separated list of CRMY ticket keys.

The manifest generator sorts and deduplicates ticket keys and adds a SHA-256
integrity digest. `targetCommit` is the reviewed source commit from `develop`;
it is not the future squash commit on `main`. The artifact must be reviewed and
committed as `release-manifest.json` in a future `release/<version>` branch
through a pull request to `main`.

## Required human sequence

1. Confirm every included functional PR is merged into `develop`, reviewed, and
   green.
2. Generate the manifest from the exact candidate SHA.
3. Review the manifest for ticket scope and absence of personal or sensitive
   data.
4. Open a release PR from `release/<version>` to `main`.
5. Obtain the required independent approval and successful required checks.
6. Merge the release PR without bypassing protection.
7. Create the tag on the exact manifest commit.
8. Publish the GitHub Release manually.
9. Let `release-publish.yml` prove:
   - the release was published by the authorized actor;
   - the tag commit is in `main`;
   - the tagged commit is associated with a human-merged release PR to `main`;
   - the manifest source commit belongs to that release PR, including when the
     PR was squash-merged;
   - every explicitly required check is present, completed, and successful;
   - the tag and commit match the manifest;
   - each Jira ticket is listed in that manifest.
10. Review the dry-run output. No Jira mutation is currently permitted.

## Refusal conditions

The Jira Done plan is refused when any evidence is missing, the ticket is not
In Review, the ticket lacks `codex-ready`, it is blocked, or its type is Epic.
A closed or merged functional PR is never sufficient evidence for Done.

`REQUIRED_RELEASE_CHECKS` is a mandatory comma-separated repository variable.
An absent or empty value refuses the release. The baseline list is:

- `unit-tests`;
- `lint`;
- `type-check`;
- `build`;
- `CodeQL`;
- `dependency-review`;
- `secret-scan`;
- `IaC-scan`;
- `container-scan`;
- `SonarQube Quality Gate`.

Check runs are retrieved with `per_page=100` until `total_count` is reached.
Missing pages, missing checks, pending checks, cancelled checks, and any
conclusion other than `success` refuse Jira completion. Additional checks do
not block the release.

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
- keeps Jira synchronization disabled and in dry-run mode.

## Rollback

Before publication, close the release PR or discard the generated artifact.
After an erroneous GitHub Release publication, mark or delete the release only
through a separate human-approved operational decision; do not rewrite Git
history. Keep Jira unchanged while dry-run is active.

If a future active synchronization completes an incorrect ticket, disable the
sync, revoke the Jira token, inspect the audit log, and request a Jira
Administrator to decide whether the controlled `Réouvrir` transition is
appropriate.
