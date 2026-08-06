# Runbook — Terraform bootstrap rollback

## Before state migration

Preserve local state, stop concurrent changes, and revert configuration through
a reviewed PR. Do not manipulate state manually unless recovery requires it and
the Product Owner authorizes the exact command.

## After state migration

Use bucket object versioning to identify the last verified state. Prevent all
writers, restore only after lineage and serial review, then reinitialize the
backend. Never delete a project while it owns state or audit evidence.

## Identity rollback

Disable the affected WIF provider first, then remove the specific service
account impersonation binding. Do not grant a basic role as a workaround.

## Repository rollback

Close an unmerged PR or create a normal revert PR after merge. Never force-push
or rewrite `develop` or `main`.
