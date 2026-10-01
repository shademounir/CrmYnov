# CRMY-54 additive audit scope

Only nullable columns and non-unique indexes are added; no data backfill.
Rollback is application-only: disable the new reader and restore the preceding
application revision while keeping audit evidence, columns and indexes intact.
Never delete or rewrite audit rows. No destructive down migration is provided.
Validate on empty ephemeral PostgreSQL only; preserve pre-existing events.
