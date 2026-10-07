# Historical bootstrap rollback

Expand-only: six new ledger/note tables and two default-compatible Lead columns.
No previously applied migration or Prisma checksum is edited. Existing Leads keep
acquisition_kind=NEW and baseline_temperature=NULL; no business history is rewritten.

First rollback is disable the bootstrap entry point and stop its producers, then
return to the compatible previous application image. Retain the additive schema,
the source chunks, plans, row decisions, receipts, provenance and historical notes.
Do not drop populated ledgers or restore a snapshot over later business writes.
If BASELINE dossiers are already written, the previous reporting binary cannot
distinguish their acquisition cohort: disable reporting or retain the corrected
cohort-aware API until a compatible rollback is available. This is not a claim
that the previous binary safely reports imported historical acquisitions.

Destructive inverse SQL is not an operational rollback. Only an isolated synthetic
database may be discarded after its preserved evidence has been verified. Qualification
must cover an empty schema, a populated synthetic copy, uniqueness, transaction
rollback, concurrent decisions, and replay after acknowledgement loss.
