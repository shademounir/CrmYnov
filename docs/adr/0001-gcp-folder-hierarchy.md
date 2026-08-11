# ADR-0001 — Google Cloud folder hierarchy

- Status: Accepted for code preparation
- Decision owner: Product Owner
- Scope: Gate -1, Phase 0

## Decision

The future folder is named `CRM Ynov` and is a direct child of organization
`1046537507934` (`casablancaynovcampus-org`). All four CRM projects belong to
this folder. No project is created directly under the organization.

## Preconditions

The active account does not currently have `resourcemanager.folders.create`.
Grant `roles/resourcemanager.folderCreator` temporarily, record its expiry, and
remove it immediately after the authorized foundation execution.

## Consequences and rollback

The hierarchy centralizes IAM, budgets, and policy visibility. Before workloads
exist, rollback is to remove empty projects and the empty folder only through a
separately approved change. No rollback is executed by CRMY-108.
