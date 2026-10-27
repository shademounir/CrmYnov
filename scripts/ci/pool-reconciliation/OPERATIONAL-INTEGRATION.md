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

Every mode verifies a separately reviewed objective catalog entry from protected
develop, exact local driver/source bytes, actual merged driver/objective reviews,
delegated decisions and required checks, the RC48 release, a fresh Jira operator
attestation and a fresh explicit operational authorization. This candidate ships
no catalog entry, no credentials and no default objective. The catalog is a later
operational approval, not an equivalent new collector or replacement sampler.

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
