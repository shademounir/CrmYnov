# Durable import cutover — preparatory increment

This increment is **not an automatic Sheets activation** and is not the complete
CRMY-63 acceptance. No real T0 or upstream identity capability is inferred from a
passing fixture. The existing relance Scheduler is a different producer.

## Delivered boundary

`/lead-import/cutover/manifests` binds one sealed bootstrap package, one stopped
connector, the exact connector configuration/version, an immutable UTC T0, its
IANA display zone, a declared original-arrival column and an evidence reference.
That evidence hash is a declaration, not upstream attestation. Source reads are
outside the transaction. Current authenticated session, role, campus, grants,
connector version and configuration are rechecked before commit and replay.

Only explicit source IDs with strict original UTC instants are supported. Row
positions, modification dates, local-date guesses and heuristic contact matches
are not identities. The equality rule is explicit: original arrival `< T0` is
`EXCLUDED_PRE_T0`; arrival `>= T0` enters a backlog requiring overlap review.
An edited historical row never becomes new. Removed/changed entries, original
payloads, hashes and decisions remain in the private durable inventory.

An observation is bounded to 10,000 rows / 4 MiB. The **accumulated inventory**,
including retained removed payloads and metadata, has the same limits. A refused
delta commits no inventory, receipt or audit and must not advance a cursor.

Overlap requires `KEEP_FOR_CATCHUP` or `LINK_BASELINE`. Linking requires an accepted
row from the bound bootstrap package and a currently readable target Lead.
Reconciliation reads the actual complete server bootstrap report; a client
boolean or a successful batch response is insufficient. `READY_FOR_CATCHUP` is
preparation, not activation, and applies no Lead effects.

The old Sheet administration and job coordinator refuse a bound preparatory
connector. They cannot bypass this boundary through an enable/manual-run request.
No automatic activation route exists. The guard is not a claim that unbound
connectors or the entire upstream Google pipeline have been qualified.

## Mutations and replay

Every mutation has a bounded `idempotencyKey`, immutable request fingerprint,
transactional receipt/audit and optimistic `expectedVersion`. Exact replay reads
the stored response after reauthorizing against current state; divergent content
under the same key is refused. Observations after a process restart continue the
same database inventory. Suspend preserves payloads and receipts. Resume clears
the freshness timestamp/readiness and requires a new observation and reconciliation.

Private source payloads are omitted from API projections and from audits; source
IDs and authorized hashes remain available to authorized operators. No payload,
real workbook, contact, password or raw Terraform state belongs in Git/Jira.

## Known incomplete contract, before any real activation

- The initial manifest is immutable and uniquely binds package/connector. A
  connector configuration change invalidates it. There is not yet a revision /
  supersede workflow; do not delete its ledger or change T0 to bypass that guard.
- Initial submission keys contain the connector ID. Before an effect consumer,
  replace this with a durable workbook + numeric sheet ID stream identity and
  prevent connector recreation from minting a new stream.
- `LOCAL_ROW` append-only mode is not supported by this cutover increment. The
  existing local-row detector is not proof of a T0-aware producer.
- No manual catch-up consumer, effect compensation, cutover UI or runtime Sheets
  activation is delivered by this preparatory increment.
- Upstream ID/original-date capability, real T0, final Excel freeze/delta review,
  STAGING rehearsal, target identities, notifications and monitoring remain
  separate operational gates. Keep Sheets OFF while these are incomplete.

## Isolated qualification

From the repository root with an official Node runtime and Docker available:

```powershell
node --import tsx --test apps/api/test/cutover-contract.test.ts
node scripts/ci/cutover-postgres.mjs
```

The PostgreSQL harness refuses an inherited `DATABASE_URL`, uses nonce-owned
loopback/tmpfs synthetic databases and a pinned local PostgreSQL image. It deploys
the previous schema, preserves a populated row and the exact old Prisma migration
checksums, applies the new migration, and separately deploys to an empty database.
A fresh Prisma client is generated **only in the private proof directory**, never
in shared dependency junctions. Compile metadata and source hashes bind the real
HTTP/application test to the inspected source. Required tests may not silently
skip. The owned container is normally stopped and its descriptor retained; tmpfs
database contents are not a backup or a tested restore.

These are local qualification results, not distant CI / Sonar / security gates.
Before a PR/release, attach actual results to its exact SHA and retain any failures.

## Rollback

Stop cutover mutations and preserve all ledgers, receipts and audits. This
increment makes no Lead effects, so a protected compatible application revert
does not require deleting data or rewriting Prisma history. The additive tables
remain. Keep a patched BASELINE-aware version; do not redeploy an old vulnerable
image or one that miscounts imported historical acquisition.

Any later catch-up consumer must document effect-level compensation and refuse
blind withdrawal after downstream activity. A global restore is not an
application rollback and cannot erase subsequent useful business writes.
