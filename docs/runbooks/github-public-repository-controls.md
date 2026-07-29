# Runbook — Public repository controls and independent review

## Current verified state

Repository: `shademounir/CrmYnov`, public, owned by the personal GitHub account
`shademounir`.

The GitHub repository API reported both controls as disabled on 29 July 2026:

- secret scanning: `disabled`;
- secret scanning push protection: `disabled`.

The local and GitHub Actions history scanners remain defense-in-depth controls,
but they do not replace GitHub native secret scanning or push protection. PR 2
must not be merged until both native controls are enabled or the Product Owner
records an explicit exception.

## Enabling secret scanning and push protection

No change is performed by this runbook. An administrator can use either:

### GitHub user interface

1. Open repository **Settings**.
2. Open **Code security** or **Security & analysis**.
3. Enable **Secret scanning**.
4. Enable **Push protection**.
5. Re-read the repository API and confirm both statuses are `enabled`.
6. Review any existing alerts before merging PR 2.

### GitHub REST API

An authenticated repository administrator can send:

```http
PATCH /repos/shademounir/CrmYnov
Content-Type: application/json

{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
```

The token must have repository Administration write capability. Do not place
that token in this repository, a workflow, a Jira issue, or a command log.

Impact: existing history is scanned, new supported secrets generate alerts,
and pushes containing detected secrets can be blocked. Contributors may need to
remove a secret from the commit before pushing.

Rollback requires a separate administrator decision: set both statuses to
`disabled` through the same UI or API, then verify the API state. Disabling
reduces protection and does not remove any secret already present in history.

## Adding an independent reviewer

The repository belongs to a personal account. GitHub personal repositories
offer owner and collaborator access, not granular organization roles. A
collaborator is non-admin but receives write access and can submit a review that
affects mergeability.

Procedure:

1. Obtain the reviewer’s exact GitHub username through an approved channel.
2. Open **Settings → Collaborators → Add people**.
3. Invite that GitHub account; do not share owner credentials.
4. Wait for invitation acceptance.
5. Verify with the collaborator-permission API that the user has `write`, not
   `admin`.
6. Request review on PR 1 first.
7. Require an approval from that independent account and resolved conversations.
8. The owner performs the human merge only after the documented GO.

Because collaborator access includes write and merge capabilities on a personal
repository, branch/ruleset protection must remain enabled and admin bypass must
not be used. If finer roles are required later, that would require a separate
Product Owner decision about organization ownership; this runbook does not
create or recommend executing such a transfer now.

To roll back reviewer access, open **Settings → Collaborators** and remove the
collaborator after the review period. This revokes repository write access but
cannot delete any local clone the reviewer may have made.

## Mandatory PR order

1. Human review and approval of PR 1.
2. Human merge of PR 1 into `develop`.
3. Fetch the updated `origin/develop`.
4. Update the PR 2 branch without rewriting remote history.
5. If a rebase would require force push, stop and request authorization.
6. Preferred no-force alternative: merge `origin/develop` into the PR 2 branch.
7. Resolve any conflict explicitly and rerun the full test suite.
8. Obtain independent human review of PR 2.
9. Merge PR 2 only after GO.

## Official references

- [GitHub REST repository security and analysis settings](https://docs.github.com/en/rest/repos/repos)
- [GitHub secret scanning REST API](https://docs.github.com/en/rest/secret-scanning/secret-scanning)
- [Enable push protection for a repository](https://docs.github.com/en/code-security/secret-scanning/enabling-secret-scanning-features/enabling-push-protection-for-your-repository)
- [Invite collaborators to a personal repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)
- [Personal repository permission levels](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository)
