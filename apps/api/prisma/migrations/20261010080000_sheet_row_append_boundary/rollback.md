# Additive append ledger: rollback and uniqueness

This migration creates nullable fields and one empty version journal. Existing
streams remain legacy: no backfill, conversion, rebaseline or Prisma-history edit.
The occurrence unique index accepts multiple NULL values; every non-NULL value
belongs to a new row and is a SHA-256 of source, immutable tab, generation and
position. The version unique constraint rejects a repeated occurrence/fingerprint.
The isolated qualification must demonstrate both collision refusals and unchanged
pre-existing rows/checksums; these claims are not substitutes for its run results.

## Operational rollback (default)

1. Disable the append worker flags and fence/disable its connector normally. Wait
   for its lease/transaction to finish; verify no active run remains.
2. Export the stream contract, qualification, row payloads, observations, ingestion
   batches and receipts to a protected archive. Verify size, digest and archive
   readability; readability alone is not a restoration test.
3. Keep this additive schema and all ledgers. Roll the application back only to a
   compatible build which recognizes this mode and refuses its execution while
   OFF. Never run a legacy LOCAL_ROW consumer against this boundary.
4. Check that flags OFF causes zero source reads and zero business effects, legacy
   stream data remains unchanged, and an existing append boundary cannot rebase.
5. Resume only forward on the same boundary/generation after the cause is fixed,
   requalification and reconciliation. No history import or cursor reset.

There is deliberately no destructive down SQL and no removal/rewriting of
`_prisma_migrations`. Once observations/effects exist, dropping fields/tables loses
deduplication and recovery evidence. Database restoration or compensation of
business effects is a separate approved procedure accounting for later writes.
On a disposable empty database only, recreate the disposable fixture rather than
claim an unsafe destructive down migration is a safe operational rollback.

## Lock/data risks

Nullable column additions require brief exclusive table locks. The unique index
scans the existing row table and may wait for writers; schedule a bounded pause,
set a lock timeout and stop on timeout rather than forcing active transactions.
Existing values are untouched and existing NULLs cannot collide. The new journal
FKs restrict deletion to preserve provenance. No values are narrowed or cast.
