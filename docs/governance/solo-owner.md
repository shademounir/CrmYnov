# Solo-owner Product Owner governance

## Scope

This document now describes the retained `manual-po` path. DEV, STAGING, and
technical Gate releases use `automated-policy` as documented in
`docs/governance/automated-policy.md`. Manual Product Owner evidence remains
mandatory for production with real data and sensitive operations.

## Mandatory sequence

1. Codex reads the authorized Jira ticket.
2. Codex develops on a ticket branch.
3. Codex pushes intentional commits.
4. Codex opens or updates a Draft PR.
5. CI runs.
6. The Product Owner manually reviews the diff, acceptance criteria, tests,
   risks, and rollback.
7. The Product Owner alone completes the checklist and adds `po-approved`.
8. The Product Owner alone marks the PR Ready for review.
9. The Product Owner alone merges from the GitHub interface.

## Reserved evidence

The `po-approved` label means: “Validation manuelle du Product Owner — ajout
interdit aux automatisations”.

Codex and workflows may only read its presence. They must never create the label
during workflow execution, add it to or remove it from a PR, complete the PO
checklist, change Draft state, merge, enable auto-merge, publish a release, or
alter human-validation evidence.

## Product Owner checklist template

The Product Owner completes this manually in the PR; Codex leaves every item
unchecked:

- [ ] Diff reviewed
- [ ] Acceptance criteria checked
- [ ] Tests and CI reviewed
- [ ] Security and residual risks reviewed
- [ ] Rollback reviewed
- [ ] `po-approved` added manually
- [ ] PR marked Ready manually
- [ ] Merge performed manually without bypass

## Branch protection target

For `develop` and `main`:

- changes only through pull requests;
- no independent GitHub approval count for the accepted solo scope;
- resolved conversations;
- successful required checks and up-to-date branch once the corresponding
  baseline checks exist on the target branch;
- linear history;
- force pushes and branch deletion disabled;
- enforcement for the administrator;
- auto-merge disabled.

Until baseline workflows are present on the target branch, required check names
must not be invented: doing so could make the bootstrap PR impossible to merge.
GitHub currently reports `required_status_checks=null` on both protected
branches. Configure the exact check contexts after their first trusted
successful run and enable strict/up-to-date enforcement in the same controlled
change.
