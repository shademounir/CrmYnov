# Codex automated pull request policy

## Separated approval modes

`automated-policy` applies to internal `feature/*` and `fix/*` pull requests to
`develop`, technical Gate release pull requests to `main`, and DEV or STAGING
deployments. It is technical policy evidence and never implies human approval.

`manual-po` remains mandatory for production with real data, Terraform
`apply` or `destroy`, IAM, billing, secrets, destructive migrations, and
security exceptions. Only the Product Owner may add `po-approved`, record the
decision comment, and perform the protected operation.

## Automated-policy evidence

The policy requires all of the following:

- internal source repository and allowlisted actor;
- branch and base pairing accepted by the naming rules;
- live Jira verification by the Codex orchestrator, recorded as an audit
  comment bound to the exact head SHA;
- non-Epic, non-blocked ticket with `codex-ready` and compatible status;
- `policy-approved`, with `po-approved` absent;
- non-Draft, conflict-free and up-to-date pull request;
- no manual-PO path and no release-manifest collision;
- every base-specific check present, completed, successful, and attached to
  the exact check SHA.

The `pr-policy` workflow is read-only. It never adds labels, changes Draft
state, merges, deletes a branch, or writes to Jira. It reads the audit comment
created by the external Codex orchestration after live Jira verification.

## Codex orchestration

1. Read and validate the Jira ticket through the authenticated connector.
2. Develop on the matching internal branch and run all local controls.
3. Open a Draft PR and wait for the initial checks.
4. Review the complete diff, changed-file classification, conflicts, branch
   freshness, required checks, and Jira acceptance criteria.
5. Generate an audit comment with `scripts/pr-policy/create-audit.mjs`, post it
   from the allowlisted account, and add `policy-approved`.
6. Mark the PR Ready. Never add `po-approved`.
7. Wait for the complete Ready-event check set, including `pr-policy`.
8. Refuse the merge if a check is missing, pending or unsuccessful; the branch
   is behind; a conflict exists; a conversation is unresolved; Jira is blocked;
   a secret is detected; the scope is `manual-po`; or bypass is required.
9. Enable native auto-merge with squash. If native auto-merge is not available,
   the explicitly authorized Codex fallback may perform the same squash merge
   only after repeating every proof and without administrator bypass.
10. Wait for the merge, verify the exact `develop` or `main` SHA, confirm source
    branch deletion, comment Jira, and leave the ticket In Review until a
    separately validated release.

## Audit comment

The audit marker contains schema version, exact head SHA, verifier, timestamp,
and a minimal Jira snapshot: key, type, status, labels, blocked flag, and scope.
It contains no Jira token, email, personal data, secret, or free-form payload.
An audit made for a different SHA or by a non-allowlisted comment author is
rejected.

## Rollback

Disable repository auto-merge, restore `PR_APPROVAL_MODE` and
`RELEASE_APPROVAL_MODE` to their previous values, remove only `pr-policy` from
required checks, and revert the implementation through a normal reviewed PR.
Do not rewrite Git history. `po-approved` remains reserved throughout rollback.
