# ADR-0003 — Temporary human Owner exception

- Status: Accepted with expiry control

## Decision

One human Owner is tolerated for bootstrap only, for at most 24 hours. No
service account receives a basic Owner or Editor role. The exception must have
an owner, start time, expiry time, reason, and removal evidence.

The target operating model uses `tf-bootstrap` through service account
impersonation. A second human identity must be reassessed before real production
operation.

## Failure mode

If least-privilege roles are not demonstrably functional before expiry, stop the
bootstrap. Extend the exception only through a new explicit Product Owner risk
acceptance; never extend it silently.
