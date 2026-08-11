# Runbook — Remove temporary Owner within 24 hours

## Record before grant

- named human principal;
- approver and ticket;
- start and mandatory expiry timestamps;
- exact reason and expected replacement roles;
- rollback contact.

## Removal

1. Prove impersonation and least-privilege paths with read-only operations.
2. Capture the IAM policy etag and the human Owner binding.
3. Remove only the approved temporary member in a separately authorized change.
4. Re-read IAM and confirm the member is absent.
5. Confirm emergency access remains available through the institutional process.
6. Attach timestamped evidence to the execution ticket.

Failure to remove before expiry is a security incident and a Gate -1 NO-GO.
