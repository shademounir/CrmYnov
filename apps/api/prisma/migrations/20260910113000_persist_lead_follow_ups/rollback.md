# Rollback — persistent Lead follow-ups

This migration is additive. Application rollback keeps `lead_follow_ups` and
`lead_follow_up_mutation_receipts` in place so that planned work, immutable
receipts and audit links are not lost.

Before any later schema removal, export both tables with the related Lead,
activity and audit rows; verify the archive with `pg_restore --list`; stop all
writers; and obtain the destructive-migration approval required by policy.
No automatic `DROP`, data rewrite or history deletion is part of this change.
