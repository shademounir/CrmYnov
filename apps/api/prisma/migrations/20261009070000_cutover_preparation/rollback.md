# CRMY-63 — additive preparatory ledger rollback

This migration creates two empty tables with restrictive foreign keys. It does
not alter existing data, types, indexes or migration history. Unique package,
connector and operation/key bindings are exercised on synthetic isolated data.

Normal rollback preserves this schema, all inventories, payloads, receipts and
audits. Stop new cutover confirmations and source observations, keep Sheets OFF,
and use a protected compatible application revert. No table deletion, migration
history editing, database reset or blind restore belongs to this rollback.

The preparation service applies no Lead effects. Readiness is not activation.
Before a later catch-up consumer is delivered, its effect receipts and explicit
compensation checks must be qualified separately. Once downstream business writes
exist, prefer an audited forward correction; a historical snapshot cannot safely
replace them. An older binary must retain the BASELINE-aware reporting and
patched dependencies already delivered by RC8.

New-table creation and indexes lock only the new ledgers. Foreign keys briefly
lock referenced package/connector tables; schedule the application migration in
the authorized deployment window. No conversion of source or business data occurs.
