# Runbook — GitHub to Jira workflow synchronization

## Scope and safety state

The automation only plans the approved CRMY transitions. The committed
configuration is deliberately non-mutating:

```text
JIRA_SYNC_ENABLED=false
JIRA_SYNC_DRY_RUN=true
```

It never posts Jira comments and never uses the administrative `Réouvrir`
transition. A missing credential, missing issue key, external fork, unauthorized
actor, blocked ticket, or missing `codex-ready` label produces a refusal or safe
no-op.

## Architecture

1. GitHub Actions receives a repository event.
2. The event normalizer extracts a key only from approved
   `feature/CRMY-<number>-description` or
   `fix/CRMY-<number>-description` branches, or from explicit release input.
3. Fork and actor controls run before Jira is read.
4. The Jira client reads status, labels, type, and blocking links when read-only
   credentials exist.
5. The policy engine selects one approved transition or refuses the event.
6. The client returns a dry-run record. Its mutation path is unreachable unless
   both `JIRA_SYNC_ENABLED=true` and `JIRA_SYNC_DRY_RUN=false`.

All output uses a sanitized configuration summary. The API token and user email
are never logged.

## Approved event mapping

| GitHub evidence | Required Jira state | Planned result |
|---|---|---|
| Valid work branch created | To Do | `2` — Démarrer le travail |
| Draft PR | To Do, In Progress, or In Review | Start, remain, or return to In Progress |
| PR ready for review | In Progress | `3` — Soumettre en revue |
| Changes requested | In Review | `4` — Reprendre le travail |
| PR merged into develop | In Review | No mutation; await release |
| PR closed without merge | Any eligible state | No transition to Done |
| Validated release published | In Review | `5` — Clôturer après release |

The release transition is refused for Epics. Transition `6` (`Réouvrir`) is not
represented in the automation code.

## Required configuration names

Names only; do not commit values:

- `JIRA_BASE_URL`
- `JIRA_CLOUD_ID`
- `JIRA_USER_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_PROJECT_KEY`
- `JIRA_SYNC_ENABLED`
- `JIRA_SYNC_DRY_RUN`
- `JIRA_SYNC_ALLOWED_ACTORS`

`JIRA_API_TOKEN` must eventually be an environment secret. Non-sensitive
identifiers can be environment variables. In the committed workflows all four
credential fields are explicit empty strings: no repository or environment
secret is read. No environment or secret is created by this change. Before
credentials are added, a separate reviewed change must bind only trusted
workflow execution to a `jira-dry-run` GitHub Environment protected by a human
reviewer.

## Public repository controls

- The workflow uses `pull_request`, never `pull_request_target`.
- Fork pull requests are refused before checkout and receive no Jira secret.
- Only the repository owner is allowed by the committed workflow.
- `GITHUB_TOKEN` permissions are limited to repository and PR reads.
- Checkout credentials are not persisted.
- Third-party actions are pinned to immutable commit SHAs.
- Fixtures contain synthetic names, repositories, issue numbers, and endpoints.
- `.env`, private keys, service-account files, and generated manifests are
  ignored.
- Unit tests scan the repository for common secret and private-key signatures.
- The event workflow scans all fetched Git patches and paths for common secret,
  private-key, service-account, and forbidden-file signatures.
- GitHub secret scanning and push protection remain repository settings and
  required branch controls.

## Creating the dedicated Jira identity

This procedure is intentionally manual and is not authorized by this change:

1. The Jira administrator creates a dedicated managed account for the
   integration. It must not reuse a human or project administrator account.
2. Add it to a dedicated project role with only:
   - Browse Projects;
   - transition permission for transitions `2`, `3`, `4`, and `5`;
   - comment permission only if a later Product Owner decision requires it.
3. Do not grant Administer Projects, Administer Jira, transition `6`, sprint
   administration, issue deletion, or priority editing.
4. Create an API token under that dedicated identity.
5. Store the email and token only in the protected `jira-dry-run` environment.
6. Validate the permissions on a controlled, non-production ticket. Confirm
   explicitly that `Réouvrir` is not visible.
7. Revoke the token immediately if any administrative capability is observed.

## Future activation procedure

Activation requires a new Product Owner decision and a separate reviewed PR:

1. Complete a real read-only dry-run limited to CRMY-23.
2. Confirm that the dedicated identity cannot administer Jira or use
   `Réouvrir`.
3. Verify branch protection, required reviews, secret scanning, CodeQL, and
   full-history scanning.
4. Protect the GitHub Environment with required reviewers and restrict it to
   approved branches.
5. Change `JIRA_SYNC_ENABLED` to `true` while retaining
   `JIRA_SYNC_DRY_RUN=true`; review the resulting plans.
6. Only after a second explicit approval, set `JIRA_SYNC_DRY_RUN=false`.
7. Observe the first transition, audit Jira history, and stop on any mismatch.

## Idempotence and error handling

Each decision receives a deterministic SHA-256 key based on the delivery,
intent, ticket, and transition. Workflow concurrency serializes equivalent
events. Jira status preconditions make redelivery a no-op after a successful
transition.

HTTP 401, 403, 404, 429, and 5xx responses are categorized without returning
credentials or response bodies. A 429 retains only the retry interval. No
automatic retry or fallback transition is performed.

## Rollback

1. Set `JIRA_SYNC_ENABLED=false` and `JIRA_SYNC_DRY_RUN=true`.
2. Disable the workflow in GitHub if immediate containment is required.
3. Revoke the dedicated Jira API token.
4. Revert the automation commit through a reviewed PR to `develop`.
5. Inspect Jira history for the affected CRMY key.
6. Never invoke `Réouvrir` automatically; any state correction is a manual Jira
   Administrator decision.

No Git history rewrite or force push is part of rollback.
