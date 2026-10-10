# Durable import cutover — preparation, catch-up and isolated worker

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
row from the bound bootstrap package and a currently readable target Lead whose
current canonical campus still matches the manifest. A global administrative
grant is not permission to link a Lead moved to a different campus ledger.
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
The guard is not a claim that unbound connectors or the entire upstream Google
pipeline have been qualified. The runtime routes below cannot arm a real Google
source.

## Minimal exception quarantine — preservation, not ingestion

`GET manifests/{id}/exceptions` exposes current source incidents and ingestion
`REVIEW` cases without source payloads or contact values. Each immutable case has
a generation and a hash of the **actual observation**: presence/absence, actual
payload fingerprint, original arrival, stream/configuration binding and headers.
The original inventory payload is preserved separately. An incident kind remains
historical: a conserved disappearance may now show `present: true`. A subsequent
edit or return creates a new case/generation; A→B→A never revives A's old decision.

An authorized operator uses `POST .../exceptions/{caseId}/disposition` with the
exact manifest version/evidence hash, an idempotency key, `confirmed: true`, a
reason of 8–500 characters and the sole action `QUARANTINE_PRESERVE`. The command
rechecks current campus, import rights and every referenced Lead/BASELINE target.
In one transaction it records the disposition, suspends readiness, pauses/disarms
the runtime, increments its epoch and abandons any owned running lease. An old
worker returning from source I/O cannot commit over that epoch. Exact replay
returns the decision and current authorized projection, never rearming anything.

The operator sequence is explicit:

1. Observe the source and inspect its current cases and true evidence.
2. Decide motivated preservation for every current case that must be isolated.
3. Perform a **new actual observation after the decision**. Neither the decision,
   its replay nor an internal journal refresh counts as a source read.
4. Reconcile the exact complete case set and the current BASELINE report.
5. Separately requalify and explicitly rearm only when the runtime contract and
   current authority permit it. A former qualification or arm receipt is not
   reused as a new authorization.

Quarantine does not create, link, retry, edit, delete or reclassify a Lead. It does
not resolve an ingestion REVIEW, alter its batch/report/review items or release
its durable submission/ingestion key. Such keys are excluded from catch-up, not
converted into NEW. `allDispositionsReconciled` means every current case is covered
and freshly reobserved/reconciled; it is distinct from `catchup.complete`, which
remains false while quarantined keys or REVIEW effects exist. Missing/extra case
references, changed bindings, inaccessible targets and new divergences fail
closed. Old manifests with nullable observation metadata require a genuine new
observation; no backfill or implicit requalification occurs.

The durable exception bound is **cumulative**, not several independent 4 MiB
allowances: the complete manifest row (inventory, observation, contract and
metadata), all preserved case payloads/evidence and all dispositions together
must stay within 4 MiB. Inventory entries + case rows + disposition rows must not
exceed 10,000. The check runs again after final state updates. Refusal rolls back
the attempted observation/disposition, version, receipt, audit and cursor; it
never truncates history to make room. Existing receipts/audits retain their own
contract; this is not a quota claim for all database storage.

This minimal disposition is not a general revision, source correction, REVIEW
resolution or recoverable compensation engine. Google qualification still stays
`PREPARATION_ONLY`; the upstream immutable-ID/original-arrival proof and real
activation gates remain open. Sheets stays OFF for real environments.

## Preparatory literal Google observation — not producer attestation

`GoogleSheetsAdapter.boundedValues` accepts an optional internal
`SheetLiteralIdentityContract` naming the two distinct ID/original-arrival
columns. This is not an HTTP configuration switch, a new credential path or a
runtime qualification. The two column names must be own properties, with no
additional contract fields, and are copied before I/O so a concurrent caller
mutation cannot rebind the observation. Existing callers do not supply it; their response mask,
business projection and `LOCAL_ROW` behavior remain unchanged.

The opt-in uses one bounded Google response for numeric tab identity, formatted
values, and entered/effective cell values. The Google field mask applies to the
whole requested rectangle, not selectively to two columns. Only the two named
columns are extracted into `literalEvidence`; additional entered/effective
metadata from other columns is not returned, persisted or logged. The existing
4 MiB response and rectangular row/column bounds still apply to the enriched
envelope. See Google's [CellData contract](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells)
and [bounded spreadsheet GET](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get).

Identity cells must be nonempty bounded literal strings, without implicit trim
or numeric conversion. Original arrival must be a calendar-valid literal UTC
instant in the existing cutover format. Formulas, spreadsheet numeric dates,
local/offset dates, missing or inconsistent entered/effective values, duplicate
IDs and ambiguous columns fail closed with expurgated errors. Physical row
numbers only locate observations; they are never submission identities. A
literal string beginning with `=` is not inferred to be a formula.

The returned kind is `LITERAL_IDENTITY_COLUMNS` and `producerAttested` is always
`false`; an initially enriched untyped contract is refused rather than trusted.
This proves the observed cell format only: not future immutability, non-reuse,
original arrival semantics, producer identity or authority. No caller hash,
checkbox, two snapshots or passing fixture may upgrade it to `GOOGLE_ATTESTED`.
The server-owned attestation/revocation registry and its fenced authority checks
remain a separate internal prerequisite, alongside the real upstream contract.
Google stays `PREPARATION_ONLY`; all existing fixture/arm guards and flags OFF
remain intact. No real Sheet read or ingestion is performed by this increment.

## External one-shot worker — synthetic qualification only

`jobs/sheet-cutover` is a dedicated bounded process, not an HTTP request or an
in-process timer. Both `SHEETS_ENABLED=true` and `SHEET_CUTOVER_ENABLED=true`, and
`CRM_BACKGROUND_WORKERS=external`, are required. OFF returns before creating an
application context, claiming a run, reading a source or applying an effect.
Both flags stay OFF in the delivered configuration; no cloud job or Scheduler
target is deployed by this code increment.

`manifests/{id}/runtime` exposes qualification and arm/disarm state separately
from manual catch-up. Qualification is server-derived, never a caller's hash or
boolean. Only the fixed synthetic provider artifact, a synthetic workbook and a
nonce-marked loopback ephemeral database can qualify and arm this implementation.
Google remains `PREPARATION_ONLY`; an upstream production qualification adapter
is still required after the immutable ID/original-arrival contract is verified.
A passing synthetic test cannot supply that attestation or enable real ingestion.

An authenticated Admin/Super Admin explicitly arms a reconciled manifest. The
creator and authorizer, their authentication versions, effective current grants,
campus scopes, role ceilings and Lead visibility are persisted/rechecked before
source I/O and every committed chunk. This is a scheduled authority, not a
fabricated user session. Audits identify `SYSTEM:CUTOVER:<manifest>` as executor
and retain the two authorizing identities separately. Revocation refuses further
effects. A BASELINE reconciliation with a target withheld from either authority
also refuses the runtime, even if its structural integrity report is complete.
Cleanup can finish only its still-owned run, never another worker's lease.

A durable epoch/owner lease fences concurrent workers and expired owners. A
one-shot reads at most one bounded snapshot per claimed manifest and processes
at most four chunks of 25 entries. Source I/O has a 30-second deadline; the lease
lasts 60 seconds and must still be current when renewed/committed. A replacement
marks an expired run abandoned, then resumes from the shared durable effect
ledger and canonical ingestion keys. A committed chunk is never recomposed just
because its process stopped or its response was lost.

The explicit arm audit records `AUTOMATIC_POST_T0_POLICY_V1`: only newly observed
durable identities absent from the already reconciled inventory, with original
arrival `>= T0` and unchanged binding/qualification, can become catch-up candidates.
Initial overlap decisions are not inferred. Late pre-T0 arrivals remain excluded;
contact collisions remain REVIEW. Changed/removed source entries pause the runtime
and preserve the original inventory. A blocked or failed run must not be reported
as successful ingestion. Minimal motivated quarantine is available as described
above; it preserves the conflict rather than correcting or ingesting its source.

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
- Effective recoverable compensation, revision/supersede workflow, correction or
  retry of SOURCE_CHANGED/SOURCE_REMOVED/REVIEW and real Google qualification remain
  unavailable. Minimal quarantine only preserves/isolates these cases. The isolated
  worker is not real Sheets activation, and a compensation request is not a withdrawal.
- Upstream ID/original-date capability, real T0, final Excel freeze/delta review,
  STAGING rehearsal, target identities, notifications and monitoring remain
  separate operational gates. Keep Sheets OFF while these are incomplete.

## Isolated qualification

From the repository root with an official Node runtime and Docker available:

```powershell
node --import tsx --test apps/api/test/cutover-contract.test.ts
node --test scripts/ci/tests/cutover-initial-rollback.test.mjs
node scripts/ci/cutover-postgres.mjs
```

The PostgreSQL harness refuses an inherited `DATABASE_URL`, uses nonce-owned
loopback/tmpfs synthetic databases and a pinned local PostgreSQL image. It deploys
the previous schema, preserves a populated row and the exact old Prisma migration
checksums, discovers the additive migration set and separately deploys it to an
empty database. All new checksums and finished/non-rolled-back history are verified.
A fresh Prisma client is generated **only in the private proof directory**, never
in shared dependency junctions. Compile metadata and source hashes bind the real
HTTP/application test to the inspected source. Required tests may not silently
skip. The owned container is normally stopped and its descriptor retained; tmpfs
database contents are not a backup. The independent custom dump described below
is the only persisted initial backup in this harness.

These are local qualification results, not distant CI / Sonar / security gates.
Before a PR/release, attach actual results to its exact SHA and retain any failures.

## Initial restoration qualification — a new synthetic clone only

Before migrations and catch-up effects, the harness creates a populated legacy
state and two non-superuser synthetic application roles. It observes drained
clients, closes the owned synthetic application connection window, takes a custom
dump, compares its container/host size and SHA-256, and reads `pg_restore --list`.
Readability alone is not a restoration result.

After reopening it records the irreversible window event and a same-cardinality
business edit. Both reopening and a changed full-state hash refuse a global rewind.
The source is never restored. After applications drain, the archive is restored
with `--exit-on-error --single-transaction` into a third, previously absent,
nonce-owned database, without `--clean`, DROP or reset. The harness compares full
public table rows/histories, sequences and exact Prisma history, plus the scoped
effective database/schema/table/sequence privileges of the two existing roles.
It also exercises an allowed transaction (rolled back) and a refused read-only
write. It rechecks that the source and its later effects are unchanged.

This is not exhaustive cluster ACL/role-membership/routine restoration, a tested
Cloud SQL restore, or a production maintenance fence. Superusers bypass connection
limits and can override default read-only. STAGING/PROD require their own enforced
producer admission/drain procedure and new-target recovery rehearsal. Never use
the harness oracle as authorization to replace an open production database.

## Rollback

Set both producer flags OFF, disarm the runtime, stop cutover mutations and drain
active runs or wait for their bounded leases to expire. Preserve all ledgers,
receipts and audits. Preparation alone makes no Lead effects. After a manual or
scheduled consumer, any created Leads remain useful persisted data; an application
revert does not undo them. A protected
compatible application revert must keep the bound source stopped and retain the
additive tables and all Prisma history. Keep a patched BASELINE-aware version; do
not redeploy an old vulnerable image or one that miscounts historical acquisition.

Any later catch-up consumer must document effect-level compensation and refuse
blind withdrawal after downstream activity. A global restore is not an
application rollback and cannot erase subsequent useful business writes.
# LOCAL_ROW_APPEND_ONLY — bounded, explicitly qualified reception

This is a separate source mode, not external-ID attestation and not a rewrite of
the v2 cutover contract. `producerAttested` remains **false**. Original submission
time is unknown; `firstObservedAt` is the time the server durably saw the row.
Phone/email and payload hashes are never occurrence IDs. A generation plus source,
immutable sheet ID and row position define the occurrence. The payload hash names
a version only. This policy cannot detect every upstream sort/rewrite; it observes
bounded snapshots, checks historical anchors and previously observed cells, and
fails closed on observable inconsistency.

## Trusted registration and distinct activation

The server reads `CRM_SHEET_APPEND_BOUNDARY_FILE`, outside any Git checkout, with
SHA-256 from `CRM_SHEET_APPEND_BOUNDARY_SHA256`. File format v1 includes mode,
workbookId, sheetId, tab, generation UUID, range, capturedAt UTC, boundaryRow and
formatted string values. N0 is recomputed from every exact nonempty value (spaces
remain occupied). Raw/effective and formatted N0 must be compared in the private
capture procedure. A capture after the decision is not retroactive; reconcile the
uncaptured interval before any real release. Neither this capture nor an existing
DEV account proves readiness of PROD.

Authenticated `POST /scheduled-sheets/:id/append-boundary` accepts only
`{expectedVersion,confirmed:true}`. The connector must be stopped, same source,
campus/mapping/context and source header. A source stream can register only one
artifact/generation. The same artifact replays without reset; a different one is
refused. Rows <= N0 never enter the new acquisition ledger.

`POST .../append-observations` persists a bounded read without business effects,
even while Sheets remains OFF. Versioned snapshots and pending/incomplete/review
rows are durable before any creation. Only empty cells in an unprocessed pending
or incomplete row may be completed; confirmed or nonempty-cell edits suspend the
stream. A conflicting valid snapshot retains its new tail and changed versions in
quarantine before suspension, but never overwrites a confirmed payload. Invalid
or over-capacity snapshots cannot be advertised as durably covered. Each read is
bounded to 4 MiB/10,000 data positions, each cell 4,000 characters; the journal is
bounded to 50,000 versions/64 MiB per stream. Capacity refuses/suspends without
purging, rebaselining or silently extending the range.

`GET .../append-reconciliation` separates last observed/durable/max confirmed row,
confirmed positions, incomplete and review counts. Max confirmed is **not** a
coverage cursor: earlier holes remain pending. The projection contains no contact
or cell text. Simulation checks the same historical/post-boundary coherence and
does not count already confirmed/review rows as new imports.

## Server-only qualification, still no activation proof

`CRM_SHEET_APPEND_QUALIFICATION_FILE` and its exact SHA-256 configuration name a
protected artifact with schemaVersion1, mode, policy `LOCAL_ROW_APPEND_ONLY_V1`,
boundaryArtifactSha256, bootstrapPackageId, excelSha256, reportSha256,
bindingSha256, evidenceSha256, qualifiedAt and
`producerCondition:{confirmedAt,evidenceSha256}`. The operator must actually obtain
and retain confirmation from the upstream responsible person and controlled
append-only evidence **after capture**, before issuing this artifact. A timestamp
and hash trace that assertion; parsing them does not establish its truth. UI booleans
or the user's policy choice alone are not operational producer confirmation.
No real artifact may be issued while this confirmation is missing.

`POST .../append-qualification` uses the trusted artifact, not caller-provided
attestation. It binds the current fully reconciled bootstrap package and exact
historical proof (`appendBootstrapProofHash`), revocable operator grants and
authentication versions. Current dossier status/owner axes may legitimately change
without changing the historical proof; exact notes/receipts/provenance, current
visibility, coverage and `cutoverBlocked=false` are recalculated before every
effect. 440 reviews/10 quarantines are NOT bypassed: bounded DEFERRED readiness is
a separate, still-required contract for that real bootstrap. Qualification does
not enable a connector. Artifact replays do not duplicate the qualification audit.

Actual execution additionally needs explicit connector activation, server flags
`SHEETS_ENABLED=true`, `SHEET_ROW_APPEND_ENABLED=true`,
`CRM_SHEET_APPEND_POLICY_QUALIFIED=true`, existing lease/version/permission fences,
current target references and bootstrap reconciliation. `job:sheet-append` is the
external worker entry point; it uses the production executor/receipts and reports
failed runs as failed, unlike a swallowed per-connector failure. OFF exits before
application initialization, SQL or Google calls. This implementation is not a claim
that the job is deployed, enabled or its cloud monitoring qualified.

Suspension persists `SHEET_APPEND_SUSPENDED`, prevents subsequent work and emits a
structured ERROR signal without cell data. Configure monitoring for this signal
and prove actual alert delivery separately; `alertRequired` is not a received mail.
The connector's saved enabled preference is not a health assertion; suspended
stream always refuses execution until explicit investigation. No automatic reset.

Rollback retains additive schema and ledgers, fences producers, exports private
evidence and resumes forward only. See migration
`20261010080000_sheet_row_append_boundary/rollback.md`; an older image that does
not recognize append mode is not a safe active consumer rollback.
