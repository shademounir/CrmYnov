# Runbook — Public repository controls and solo-owner governance

## Current verified state

Repository: `shademounir/CrmYnov`, public, owned by the personal GitHub account
`shademounir`.

The Product Owner authorized activation on 29 July 2026. The repository API
was read again after the change and reported:

- secret scanning: `enabled`;
- secret scanning push protection: `enabled`.

The local and GitHub Actions history scanners remain defense-in-depth controls,
but they do not replace these native controls.

## Enabling secret scanning and push protection

An administrator can use either:

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

## Solo-owner validation

The Product Owner has accepted solo governance for bootstrap, development, MVP,
DEV, and STAGING. GitHub approval from a second account is therefore not a
merge prerequisite for this scope.

Human validation evidence is:

- `po-approved`, created at repository level but added to a PR only by the
  Product Owner;
- the PO checklist completed manually;
- the PR changed from Draft to Ready manually;
- successful CI records;
- a manual merge from the GitHub interface;
- retained PR history.

Codex and GitHub Actions may verify this evidence but must never add or remove
the label, complete the checklist, mark a PR ready, merge, enable auto-merge, or
use administrator bypass.

## Bootstrap branch protection snapshot

The API-reported state for both `develop` and `main` is:

- pull request required, with zero GitHub approvals for solo governance;
- code-owner and last-push approval disabled;
- conversations must be resolved;
- linear history required;
- force push and deletion disabled;
- administrator enforcement enabled;
- repository auto-merge disabled at bootstrap time; it is now enabled for the
  separately governed `automated-policy` path and does not relax `manual-po`.

Required status checks are not yet configured because no common baseline check
exists on the target branches. GitHub refused enabling strict status-check
protection without an existing context. Inventing a context now would make the
bootstrap PR impossible to merge. After the first trusted CI workflow lands,
configure its exact reported check name with `strict=true` and verify the
latest PR commit satisfies it.

## Mandatory PR order

1. Enable GitHub secret scanning and push protection.
2. The Product Owner marks PR 1 ready, reviews it, completes the checklist, and
   adds `po-approved`.
3. The Product Owner manually merges PR 1 into `develop`.
4. Fetch the updated `origin/develop`.
5. Update the PR 2 branch without rewriting remote history.
6. If a rebase would require force push, stop and request authorization.
7. Preferred no-force alternative: merge `origin/develop` into the PR 2 branch.
8. Resolve any conflict explicitly and rerun the full test suite.
9. The Product Owner reviews PR 2, adds `po-approved`, marks it ready, and
   manually merges only after GO.

## Official references

- [GitHub REST repository security and analysis settings](https://docs.github.com/en/rest/repos/repos)
- [GitHub secret scanning REST API](https://docs.github.com/en/rest/secret-scanning/secret-scanning)
- [Enable push protection for a repository](https://docs.github.com/en/code-security/secret-scanning/enabling-secret-scanning-features/enabling-push-protection-for-your-repository)
- [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
