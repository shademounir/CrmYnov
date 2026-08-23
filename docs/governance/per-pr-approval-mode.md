# Per-PR approval mode

CRMY-124 removes the global approval-mode decision. `PR_APPROVAL_MODE` remains
the default for an ordinary pull request, while the reviewed diff, Jira scope,
and release profile determine `effectiveApprovalMode` for each PR.

## Classification

`manual-po` takes precedence when any changed file concerns GitHub governance,
approval rules, IAM/WIF, billing/budgets, secrets, Terraform bootstrap/backend/
state or mutative operations, PROD, destructive data migrations, security rules
or exceptions, branch protections, or workflows capable of writing to GitHub,
Jira, or GCP. Application releases are also manual. A mixed or unknown scope
is manual. The reason is emitted as a stable category without file contents or
secrets.

Only known application/test paths and non-sensitive documentation are ordinary.
Next.js App Router paths under `apps/web/app` are also ordinary when every
segment is a validated static segment, dynamic parameter (`[param]`), catch-all
(`[...param]`), optional catch-all (`[[...param]]`), route
group, or parallel route. The classifier normalizes Windows separators and
fails closed for absolute paths, traversal, NUL characters, malformed brackets,
empty parameters, unknown roots, and any mixture with sensitive files.
The existing isolated `gate-1` release manifest remains automated. A global
`manual-po` default can tighten an ordinary PR; the global automated default can
never weaken a sensitive PR.

## Manual evidence

The read-only `pr-policy` check requires all of the following on the exact head
SHA before it can pass:

- trusted repository, non-fork source and allowlisted actor;
- valid, unblocked, `codex-ready` Jira ticket;
- `po-approved`, with exactly one traceable label event from the allowlisted
  human account, and no `policy-approved`;
- all seven Product Owner checklist items checked in the PR body;
- latest structured `manual-po-decision` comment approved for the PR and SHA by
  the allowlisted human account;
- PR manually changed from Draft to Ready;
- `auto_merge=null`, no auto-merge timeline event and no detected bot merge;
- all required technical checks green on the exact SHA;
- all review conversations resolved, complete thread pagination, branch current,
  and no merge conflict.

The workflow reads this evidence. It has no write permission and cannot add a
label, edit the description, mark Ready, enable auto-merge, approve, or merge.
The Product Owner performs every manual action. Repository administrators remain
subject to branch protection; this workflow contains no bypass path.

## Automated evidence

Ordinary PRs retain the existing SHA-bound Jira audit, `policy-approved`, green
checks, current branch, no `po-approved`, and the existing controlled merge path.

## Rollback

Before merge, close the Draft PR and delete only its branch. After merge, use a
protected revert PR. Do not change the repository variable to weaken sensitive
classification and do not bypass branch protection.
