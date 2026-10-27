# Dedicated pool-only observation building block

This source adds fixed, bounded SELECTs and an injected Prisma transaction adapter.
It does not construct a client, read credentials, create or run a job, provide a
CLI, authenticate native evidence, reconstruct a historical hash, accept a new
baseline, or authorize deployment/activation. Tests use in-memory transports.

The intended native purpose is separate from the immutable RC47 preservation
sampler. Its image, purposes, catalog and authority are not retargeted. The pool
collector does **not** observe the migration ledger, mail, dispositions or Sheets
boundary; it cannot stand in for a full production PRE/POST preservation probe.
The known ledger accessibility gap remains an explicit independent gate.

All reads must run in one RepeatableRead READ ONLY transaction with bounded
timeouts. Every query is fixed, with only campus/campaign UUIDs as parameters.
Limit-plus-one sentinels and byte limits reject ambiguous or oversized results.
Audit/version queries do not filter by the expected actor, version or window:
such filtering could hide a contradiction. Private audit metadata values are not
read; only their absence is reported. No locks, writes, cohorts, seeds or retries.

Returned raw snapshot is private evidence, never stdout/public PR data. The
existing protected semantic contract must separately check it against the pinned
original intent, independent actor UUID hash and reviewed historical window.
Current human/UI identity binding is not cryptographic proof of historical account
continuity. Future mismatches must be rejected rather than accepted from the audit.

Still required: reviewed operational entry/image/source inventory, bounded private
output format and independent official native-output verifier; protected purpose,
driver/objective/catalog and single-use journals; exactSHA CI/security/review,
applicable Jira/grant/audit, and then actual authorized native observations. This
building block alone cannot satisfy any of those gates.
