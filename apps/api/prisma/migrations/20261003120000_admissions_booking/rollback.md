# Admissions booking — additive rollout and rollback

Four new tables are empty at installation. Unique indexes constrain only those new tables: `(user_id,campus)` is one explicit designation, appointment primary key is one request per appointment, `(actor_id,operation,key)` identifies one immutable receipt. No uniqueness is assumed or added on populated legacy tables. Foreign keys reference preserved collaborators/appointments; no existing row or `_prisma_migrations` entry is rewritten. The migration acquires brief locks for foreign-key installation; schedule deployment off peak and observe lock waits. No extension, type conversion or data backfill is required.

## Application rollback is conditional

Do **not** return blindly to an API which ignores booking metadata: it could confirm, reschedule or cancel a pending Admissions request through the old transition endpoint. Freeze new Admissions requests and agenda edits first. Retain the API guard/participant-lock implementation, or first resolve every active request through the controlled application under explicit authorization. Returning to an old API without those guards is only safe when no non-terminal Admissions booking remains and the Admissions UI/links are disabled. No request is auto-accepted/cancelled for rollback. Existing appointments, events, receipts, notifications and audits remain intact.

The safe production/data-preserving rollback leaves all four additive tables and their migration history in place and rolls back the affected UI only (compatible API stays available). A later removal requires a separate reviewed migration and retention decision; no `DROP`, reset, artificial checksum or history edit belongs to this rollout.

## Isolated evidence required

Run `prisma migrate deploy` on an empty synthetic database and on an isolated populated prior schema. Verify legacy rows/history/checksums unchanged, new checks/FKs/unique indexes, concurrent application requests, and receipt/event/activity/audit/notification uniqueness. On a disposable clone, test the conditional UI/application rollback with data preserved; it is not a Cloud SQL restoration proof. Physical removal of new tables, if tested solely in a disposable transaction rolled back, is not the supported runtime rollback strategy.
