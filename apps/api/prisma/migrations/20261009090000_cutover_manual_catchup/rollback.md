# Manual catch-up rollback

This migration only adds a nullable durable stream binding and an empty effect
ledger. Existing manifests and Prisma history/checksums are retained. No data
conversion/backfill or uniqueness guessed from contacts is performed. Existing
v1 manifests remain readable but cannot consume; no implicit upgrade is allowed.

Stop manual mutations/Sheets producers and preserve both manifests and receipts.
Rollback the application only to a patched, BASELINE-aware compatible version.
Do not run the legacy Sheet executor for a bound source. Keep the new tables and
stream bindings; no destructive inverse, schema reset or blind database restore.

After catch-up created Leads, an application rollback does not undo those effects.
Compensation here only records a suspended request/comparison, never withdraws,
deletes or changes a business status. A changed Lead/dependency is blocked.
Effective recoverable withdrawal needs its own implemented authorized mechanism;
no such behavior is claimed by this migration or by the comparison API.

The nullable unique index locks the manifest table briefly; the new FK references
the existing manifest table. No existing Lead table or type is changed.
