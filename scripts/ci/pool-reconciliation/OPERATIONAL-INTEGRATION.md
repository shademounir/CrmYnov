# Pool operational integration candidate

This candidate connects the already protected collector and semantic contract to
a dedicated RC48 runtime entry, encrypted output, fixed official output reads and
durable single-use CREATE/RUN transactions. It does not change any RC47 source,
purpose, pin or existing sealed checkout. Application images are reused by digest;
there is no application bootstrap, provider invocation, migration, or DB write.

The entry loads only the generated Prisma client in the qualified RC48 API image.
All fixed pool queries execute in the collector's single RepeatableRead READ ONLY
transaction. The raw snapshot is gzip/AES-256-GCM sealed to a reviewed RSA public
key; the private key stays on the operator computer. Stdout contains only the
sealed envelope and job context, never the raw pool, URL or private key.

`pool-operational-driver-v1.mjs` requires an explicit mode and absolute private
dossier/Jira/journal paths. `create-job --initialize yes` is single-use journal
initialization, not authority. Unknown native outcomes remain occupied. `run`
requires the journal's reconciled creation UID, unused native execution inventory
and unchanged latest etag; no task override or automatic retry exists.
Native CPU representations are validated before normalization; only `1` and
`1000m` are equivalent. Both the job and execution must match the one-CPU task.
The dossier explicitly binds the existing PROD VPC/subnet and
`PRIVATE_RANGES_ONLY` egress observed in native metadata. It neither creates nor
modifies that network. The runtime URL is the existing versioned secret reference;
no Cloud SQL socket mount or credential rewrite is introduced for private TCP.

Every mode verifies a separately approved objective catalog entry from protected
develop, exact local driver/source bytes, actual protected driver/objective merges,
delegated decisions and required checks, the RC48 release, a fresh Jira operator
attestation and a fresh explicit operational authorization. This candidate ships
no catalog entry, no credentials and no default objective. The catalog is a later
operational approval, not an equivalent new collector or replacement sampler.

The owner's versioned GitHub code-review policy is loaded from the actual
protected develop revision, never from local overrides. Missing, Running or stale
Codex bot summaries are informational, not required approval. Actual unresolved
conversations/change requests, all technical checks and delegated decisions remain
mandatory. No bot result is rewritten or falsely reported as clean; see
`docs/governance/github-code-review-policy.md`. The immutable RC47 executor and
its own historical authority module are not changed or run by this extension.

`read-output` accepts only the execution recovered from the durable RUN journal.
It reads the actual job/execution and a bounded Cloud Logging `entries:list` query
for that execution/task/attempt/stdout. That POST lists logs; it does not run a job.
Pagination, duplicates, altered template/source/key/nonce/phase, stale results,
wrong identity/database, retries and failures refuse. Decryption and original
intent reconciliation occur privately. Typed fixtures do not authenticate native
origin, and no cryptographic Google signature is claimed.
The bounded JSON reader is shared with native transaction metadata reads. Output
GET/GET/log-list remain sequential, with durable per-request intent/result and no
automatic retry; source-file reads retain a maximum concurrency of four.

The reviewed original intent, independent actor mapping and proposed historical
window remain mandatory. The historical raw hash is not reconstructed. A valid
fresh PRE is constrained preservation evidence, not a new historical baseline.
POST uses a distinct job and preserves the complete fixed raw hashes and valid
nondecreasing prospective counters.

The pool observation does not cover the migration ledger, Leads, mail, Sheets or
547 dispositions. Separate existing-identity READ ONLY schema/ledger qualification
and the full preservation/deployment dossier remain mandatory; different
transactions are never represented as one snapshot. No backup/apply/activation
or native acceptance is granted by this candidate, its tests, or a source merge.

## Relevant official API contracts

- [Cloud Run execution metadata](https://docs.cloud.google.com/run/docs/managing/job-executions)
- [Cloud Run stdout platform labels](https://docs.cloud.google.com/logging/docs/api/platform-logs)
- [Cloud Logging entries.list](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list)

The isolated PostgreSQL fixture is entirely synthetic. A local container test is
not a Cloud Run, official authentication, PROD SQL or business reconciliation test.
# Explicit readonly purpose extension (source qualification still required)

The same operational driver and single-use transaction journal support only
`POOL_RECONCILIATION_READ_ONLY_V1`, `GENERAL_PRESERVATION_READ_ONLY_V1` and
`SCHEMA_LEDGER_READ_ONLY_V1`. Non-pool execution requires an explicit matching
`--purpose`; there is no default objective. The historical pool APIs remain
pool-only. The immutable RC47 sampler, its namespace and its image pins are not
retargeted.

General preservation uses the existing runtime identity. The ledger uses the
separate existing migrator identity in a READ ONLY transaction; this does not
grant runtime access to the ledger. Each profile has a fixed job prefix, service
account and versioned secret reference. Scope is rechecked after token acquisition
before POST. A missing, mismatched, expired or unmerged authority fails closed.

The non-pool `read-output` mode accepts a private key and output directory, not
pool reconciliation inputs or a prior pool proof. Its minimized receipt contains
digests, source/role/job/execution bindings and transaction times, never the raw
snapshot or private key. Ciphertext and native metadata receipts remain durable.
`nativeAcceptance`, `fullProductionPreflight`, `schemaCompatibilityProved` and
`activationAuthorized` remain false. Separate purpose transactions are never
represented as a common snapshot.

The source/tooling lot must be merged under normal protections before the
concrete catalogue can name its real driver merge SHA/tree/files. The catalogue
may refer to its own PR number, but embedding its own driver merge SHA would be
circular. Local anticipatory integration of a pending candidate is not a
protected merge. No job, SQL, backup, deployment or activation is authorized by
this documentation or by local qualification.
