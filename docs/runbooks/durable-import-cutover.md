# Durable import cutover — preparation and manual catch-up

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

New v2 manifests use a unique stream hash of **workbook + numeric sheet ID**,
including valid ID `0`. A renamed tab or recreated connector is not a new stream.
The stream and mapping/configuration/version are immutable. Existing v1 ledgers
remain readable; they cannot silently upgrade into an effect consumer. For Google,
the existing allowlisted `boundedValues` response contains tab properties and
cells together; observation rechecks its actual numeric sheet ID. A caller-declared
ID on a synthetic fixture is never evidence of Google's source capability.

Only explicit submission IDs with strict original UTC instants are supported. Row
positions, modification dates, local-date guesses and heuristic contact matches
are not identities. The equality rule is explicit: original arrival `< T0` is
`EXCLUDED_PRE_T0`; arrival `>= T0` enters a backlog requiring overlap review.
An edited historical row never becomes new. Removed/changed entries, original
payloads, hashes and decisions remain in the private durable inventory.

This first lot requires **the final Excel freeze after delta review to equal T0**
as the same normalized UTC instant. It refuses any uncovered `[freeze, T0)` window
at creation, reconciliation and consumption, including older preparatory manifests.
Without an independently attested delta, an arrival in that gap could otherwise be
excluded as historical despite being absent from Excel. Equal declared instants
are necessary, **not proof of the real final freeze**: before a real import retain
the final snapshot/hash and verify every occurrence and final delta coverage.
Do not fabricate matching timestamps to bypass this gate. Unequal freezes require
a future explicit, evidenced delta contract, not silently promoting pre-T0 rows.

An observation is bounded to 10,000 rows / 4 MiB. The **accumulated inventory**,
including retained removed payloads and metadata, has the same limits. A refused
delta commits no inventory, receipt or audit and must not advance a cursor.

Overlap requires `KEEP_FOR_CATCHUP` or `LINK_BASELINE`. Linking requires an accepted
row from the bound bootstrap package and a currently readable target Lead.
Reconciliation reads the actual complete server bootstrap report; a client
boolean or a successful batch response is insufficient. `READY_FOR_CATCHUP` is
preparation, not activation, and applies no Lead effects by itself.

## Explicit bounded manual catch-up

`POST manifests/{id}/consume` requires current effective create/view/import rights,
`expectedVersion`, a stable idempotency key, `confirmed: true` and a limit of 1–25.
It verifies the current server report/hash and exact source mapping/configuration.
The ordered mapping header hash must match the actual observed headers; PostgreSQL
JSON object key order is never substituted for the original column order.
This is an authenticated operator action, not an automatic producer.

For each resolved backlog entry, a unique durable effect is persisted with the
manifest receipt/audit and canonical ingestion in the **same fenced transaction**.
`KEEP_FOR_CATCHUP` goes through `PersistentIngestionService` in `NEW` acquisition
with source identity namespaced by its durable stream/submission hash. Any contact
collision is `REVIEW`, never heuristic attachment. Current references, assignment
policy, commercial eligibility and permissions are re-evaluated; no eligible
candidate leaves a durable unassigned reason, not a repeated random draw.
`LINK_BASELINE` only references the explicitly accepted historical row/Lead: it
creates no Lead, activity, provenance, notification or NEW reception.

The effect ledger is the restart cursor. The consumer selects only resolved entries
without an effect; a lost response reads its receipt, and a new bounded request
after a restart continues the same ledger. Reviews remain explicit and do not count
as successfully imported. `catchup.complete` is separate from automatic activation.
The legacy job guard also recognizes the bound workbook/sheet stream on a recreated
Google connector. Sheets remains OFF.

## Conservative compensation request — not an accomplished withdrawal

`POST manifests/{id}/compensate` requires a source key, reason, explicit confirmation
and current import/Lead-edit authority. It compares a hash of the created Lead,
every direct foreign-key dependency's full rows and Lead-scoped audit rows, not
only timestamps or counts. It then suspends the manifest and records `REQUESTED`
when unchanged or `BLOCKED_DOWNSTREAM` when any later write is detected.

Both results have `applied: false` / `compensationApplied: false`. They do **not**
delete, retire, reclassify, close or restore a Lead. Recoverable withdrawal is not
implemented in the current base; introducing a central retirement workflow is not
silently bundled here. An actual compensation remains a separately controlled
forward action. `REQUESTED` must never be displayed as `COMPENSATED`.

The old Sheet administration and job coordinator refuse a bound preparatory
connector. They cannot bypass this boundary through an enable/manual-run request.
No automatic activation route exists. The guard is not a claim that unbound
connectors or the entire upstream Google pipeline have been qualified.

## Mutations and replay

Every mutation has a bounded `idempotencyKey`, immutable request fingerprint,
transactional receipt/audit and optimistic `expectedVersion`. Exact replay reads
the stored business response after reauthorizing all formerly visible Lead and
BASELINE targets against current state and reprojecting current capabilities;
loss of a referenced Lead right refuses replay without new effects. Divergent content
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
- `LOCAL_ROW` append-only mode is not supported by this cutover increment. The
  existing local-row detector is not proof of a T0-aware producer.
- Effective recoverable compensation, revision/supersede workflow and automatic
  runtime Sheets activation remain unavailable. The manual API is not an upstream
  worker, and a compensation request is not a withdrawal.
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
checksums, applies both additive migrations, and separately deploys them to an empty
database. Both new checksums and finished/non-rolled-back history are verified.
A fresh Prisma client is generated **only in the private proof directory**, never
in shared dependency junctions. Compile metadata and source hashes bind the real
HTTP/application test to the inspected source. Required tests may not silently
skip. The owned container is normally stopped and its descriptor retained; tmpfs
database contents are not a backup or a tested restore.

These are local qualification results, not distant CI / Sonar / security gates.
Before a PR/release, attach actual results to its exact SHA and retain any failures.

## Rollback

Stop cutover mutations and preserve all ledgers, receipts and audits. Preparation
alone makes no Lead effects. After an explicit manual consumer, any created Leads
remain useful persisted data; an application revert does not undo them. A protected
compatible application revert must keep the bound source stopped and retain the
additive tables and all Prisma history. Keep a patched BASELINE-aware version; do
not redeploy an old vulnerable image or one that miscounts historical acquisition.

Any later catch-up consumer must document effect-level compensation and refuse
blind withdrawal after downstream activity. A global restore is not an
application rollback and cannot erase subsequent useful business writes.
