# Controlled forward rollback

Keep all exception cases, dispositions, observations, payload evidence, effects,
receipts and business history. Do not drop tables, rewrite Prisma history, reset
or restore over live data. This migration only adds nullable observation metadata
and initially empty journals. A pre-migration application does not understand
quarantines and MUST NOT run against manifests using this contract.

Before an application rollback: keep both Sheets flags OFF, disarm runtimes,
finish or fence active jobs, and retain the compatible BASELINE application.
QUARANTINE_PRESERVE never withdraws a Lead, changes a REVIEW effect/batch, or
releases its durable ingestion identity. A database restore is only possible in
the independently verified closed initial window, not after useful later writes.

Qualification requires migration on empty and populated isolated copies,
unchanged prior migration checksums, journal uniqueness/replay/concurrency tests,
and verified current source evidence; declared hashes are not Google attestation.
