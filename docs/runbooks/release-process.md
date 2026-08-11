# Runbook — Policy-validated release process

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

## Required release sequence

1. Confirm every included functional PR is merged into `develop`, reviewed, and
   green.
2. Generate the manifest from the exact candidate SHA.
3. Review the manifest for ticket scope and absence of personal or sensitive
   data.
4. Open a release PR from `release/<version>` to `main`. This is a separate
   future authorization; the current preparation PR targets only `develop`.
5. For a technical Gate, Codex records the SHA-bound Jira audit, adds
   `policy-approved`, marks the PR Ready, and waits for `pr-policy` plus every
   required Gate check. For PROD or an application profile, the Product Owner
   instead records a manual decision and adds `po-approved`.
6. Merge by squash without bypass. Technical Gates may use native auto-merge or
   the explicitly authorized Codex fallback. PROD remains a manual PO merge.
7. Confirm the four Gate-1 checks completed successfully on the exact resulting
   `main` SHA. For the first technical release, follow the bootstrap procedure
   in `docs/runbooks/gate1-first-release.md`.
8. Only then create the tag on the exact manifest commit.
9. Publish the GitHub Release manually.
10. Let `release-publish.yml` prove:
   - the release was published by the authorized actor;
   - the tag commit is in `main`;
   - the tagged commit is associated with a validated release PR to `main`;
   - `RELEASE_APPROVAL_MODE` is `automated-policy` for a technical Gate or
     `manual-po` for the retained manual path;
   - an automated Gate carries `policy-approved`, has a successful `pr-policy`
     check on the release branch SHA, and was merged by an allowlisted actor;
   - a manual release carries `po-approved`, has no auto-merge request or
     auto-merge timeline event, and has a traceable Product Owner decision
     bound to the exact PR number and head SHA;
   - the manifest source commit belongs to that release PR, including when the
     PR was squash-merged;
   - every explicitly required check is present, completed, and successful;
   - the tag and commit match the manifest;
   - each Jira ticket is listed in that manifest.
11. Review the dry-run output. No Jira mutation is currently permitted.

## Manual Product Owner decision evidence

Repository auto-merge may stay enabled for technical `automated-policy` PRs.
The `manual-po` proof is deliberately scoped to the sensitive PR and remains
fail-closed. The release workflow uses only read permissions (`contents`,
`checks`, `issues`, and `pull-requests`) and no administrator PAT.

After reviewing the exact head SHA, the Product Owner posts this PR comment
manually, replacing the placeholders:

```text
<!-- manual-po-decision {"schemaVersion":1,"decision":"approved","pullRequest":<number>,"headSha":"<40-character SHA>"} -->
```

GitHub supplies the immutable comment id, author, and creation timestamp. The
validator accepts only the latest structured decision marker, requires its
author to be allowlisted, binds it to the PR number and head SHA, and requires
it to predate the manual merge. `po-approved` remains independently mandatory.
The PR must report `auto_merge: null`, and its timeline must contain neither an
`auto_merge_enabled` nor an `auto_merge_disabled` event. A later `revoked`
decision marker makes validation fail closed.

## Refusal conditions

The Jira Done plan is refused when any evidence is missing, the ticket is not
In Review, the ticket lacks `codex-ready`, it is blocked, or its type is Epic.
A closed or merged functional PR is never sufficient evidence for Done.

In manual mode, validation refuses when the structured decision is missing,
revoked, untraceable, written by a non-allowlisted actor, bound to another PR
or SHA, dated after merge, or when any PR auto-merge evidence exists.

The required check list is selected from the integrity-checked manifest
profile. An empty profile list, unsupported profile, missing check, pending
check, failed check, or check attached to a SHA other than the exact release
commit refuses validation. A Draft or unmerged release PR, a base other than
`main`, missing mode-specific evidence, absent ticket, or Epic closure is also
refused.

Check runs are retrieved with `per_page=100` until `total_count` is reached.
Missing pages, missing checks, pending checks, cancelled checks, and any
conclusion other than `success` refuse Jira completion. Additional checks do
not block the release.

`RELEASE_APPROVAL_MODE` is mandatory. `automated-policy` accepts only the
`gate-1` profile, a `release/v...` branch, `policy-approved`, allowlisted author
and merger, and a successful `pr-policy` check on the exact release-branch SHA.
It explicitly rejects `po-approved` and every application/PROD profile. The
retained `manual-po` path continues to require traceable manual evidence and
refuses configured PR auto-merge or any auto-merge timeline event. Global
repository auto-merge state does not decide the manual PR outcome.

## Public repository protections

Release manifests contain ticket keys and commit identifiers only. They must
not contain applicant data, telephone configuration, endpoint credentials,
tokens, internal hostnames, or environment values.

The release workflow:

- is triggered from trusted release metadata, not `pull_request_target`;
- uses only `contents: read`, `checks: read`, `issues: read`, and
  `pull-requests: read`; all
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

`v0.1.0-gate.1` is retained as the failed published attempt and must never be
rewritten. Any corrected Gate-1 publication uses the next version
`v0.1.0-gate.2` after separate Product Owner authorization.
