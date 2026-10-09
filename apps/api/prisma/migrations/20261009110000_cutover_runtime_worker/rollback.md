# T0-aware worker rollback

Additive empty runtime/run/receipt tables reference existing manifests. Existing
Prisma migration files and checksums, sealed packages, effects and Leads are not
rewritten. Unique manifest primary key, (manifest,epoch) and request keys are
qualified on the nonce-owned empty/populated databases, not on production data.

Keep SHEETS_ENABLED=false and SHEET_CUTOVER_ENABLED=false; disarm the runtime,
wait for bounded leases/runs to complete or expire and retain the journal. Roll
back only to a patched BASELINE-compatible application that keeps the legacy
bound-stream guard. Keep all additive tables; no DROP, Prisma resolve/reset,
blind restore or destructive inverse is authorized.

Committed NEW Leads are not undone by application rollback. Compensation remains
a conservative suspended request/refusal, not a performed withdrawal. Business
edits after ingestion make database replacement unsafe; a preserved initial
clone proves only the controlled pre-business-write recovery window.

Creating empty tables/FKs takes metadata locks on manifests, no conversion or
existing Lead-table lock is introduced. Google qualification is PREPARATION_ONLY;
the synthetic provider can arm solely in the nonce-owned isolated test database.
