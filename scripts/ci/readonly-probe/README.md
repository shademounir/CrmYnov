# RC47 read-only preservation probe

Operational helper sources only; no automatic deployment, database write, mail dispatch or Sheets activation.

The core exposes 13 closed, bounded SELECT queries and minimized validation. The adapter sets RepeatableRead/READ ONLY and finite timeouts before reading. Three runtime modules (core, adapter, controlled entry) are transported in an acyclic gzip bundle; the fourth native verifier runs in the external orchestrator. Neither an environment SHA nor a local simulation is a native Cloud Run receipt.

Before a real job: require exact-source review and fresh Jira/delegation, a separate reviewed objective, pinned image and helper/bundle hashes, versioned DATABASE_URL secret reference, actual native job GET matching the objective, single task/attempt with no retry and bounded resources. Reconcile completed native execution separately; never retry an unknown outcome.

The external transaction components use the latest native job etag in a single run request, with no task overrides, and refuse any pre-existing or unknown execution. The durable create-exclusive SQLite journal is consumed before POST; an unknown outcome is never replayable, including after reopening. Known-operation recovery reads the durable journal rather than accepting a caller-supplied operation.

`createProbeExecutor` composes the fixed native validators, bounded HTTP transport and journal. It detaches the objective from mutable caller input. It requires an explicit fresh-authority verifier and authentication callback; there is no CLI, job creation, default authorization or production activation. The official gcloud token adapter uses the installed Google SDK's fixed bundled Python interpreter and gcloud entry point without a shell. It rejects ambient authentication overrides and active authentication configuration, pins empty override properties for the child, and verifies those effective properties before token issuance. Authentication has finite deadlines and redacted errors, with file logging disabled; no token is logged or written to a receipt. Its unit tests inject synthetic subprocess responses, not real authentication. Local native-configuration qualification uses isolated synthetic SDK profiles and intercepts token issuance; it is not native PROD authentication or execution acceptance.

These components alone do not qualify a real executor invocation. Before use, the driver and fresh authority verification must themselves be protected, reviewed and source-qualified, with the separate objective and qualified native job/execution receipts. Offline fixtures use synthetic authority, tokens and HTTP responses and must never be labelled native PROD acceptance. Tests write disposable SQLite journals in the OS temporary directory, not in source checkouts.

The token endpoint is explicitly pinned to `https://oauth2.googleapis.com/token`, not emptied: an explicitly empty SDK endpoint breaks refresh. Effective configuration must confirm that canonical endpoint. Identity/token-file overrides remain cleared and TLS validation remains enabled. Additional local qualification reconstructs fabricated credentials with the installed SDK and executes its refresh logic against a fully simulated HTTP transport; it never reads personal credentials, contacts an OAuth server or obtains a real token.

PRE/POST output contains states, counts and hashes, not contacts, database credentials, raw settings or provider IDs. PRE is not deployment/transport/human acceptance. New journal rows and increasing prospective counters are preserved; existing immutable journal evidence and protected records must not diverge.

The checked-in inventory contains only 277 file paths and SHA256 values bound to existing immutable RC47 API bytes. The synthetic image harness must run only in a network-isolated local fixture with a generated client from that image, never against PROD. No Prisma generation is performed while PostgreSQL is alive.

The protected application release, real H2585/H2586, 547 existing dispositions, N0/generation/resume, useful flags, fresh backup, compatible plan, unique apply, and real native/visual role acceptance remain separate gates. These helpers do not waive any gate or modify IAM, DNS, edge, audio, Schedulers, mail configuration or historical data.

## Operational driver candidate (not yet protected or authorized)

`probe-operational-driver-v1.mjs` adds explicit `verify`, `create-job`,
`observe-create`, `run`, and `observe-run` modes. Every mode requires
`--objective-id ID --dossier ABSOLUTE_JSON --jira-evidence ABSOLUTE_JSON
--journal-dir ABSOLUTE_EXISTING_DIRECTORY`. First creation and first run require
respectively `--initialize-create yes` and `--initialize-run yes`; these are
create-exclusive journal initialization, not authorization. No action is default.
Do not execute these modes until this driver is independently protected/reviewed
and its exact local source checkout is clean and matched to official GitHub bytes.

There is intentionally no catalog or objective entry shipped. The driver reads
`docs/governance/readonly-probe-objectives-v1.json` from the actual protected
develop revision. An independent later reviewed catalog PR must bind a prior
merged driver commit/tree and all18 loaded source files, a canonical private
dossier digest, immutable baseline lineage (settings/memberships/permissions/pool),
the approved journal-directory hash, Google account, allowed narrow actions,
validity interval, human authority receipt digest, and RC48 release evidence.
Its `objectiveReview` contains only its already-known draft PR number: the actual
head/merge are derived from GitHub after merge, avoiding a self-referential hash.
The catalog entry at that actual merge must exactly equal the current entry.

After that catalog merge, an authenticated allowed actor must post a fresh
`codex-readonly-probe-objective-authorization:v1` marker on its objective PR,
binding the exact entry/dossier/driver, actions, grant, human authority reference,
and fresh Jira operator observation hash. Both are at most ten minutes old.
The JSON Jira receipt explicitly says it is an operator-observed official UI
attestation, **not** a cryptographic Jira connector or native signature. Its
schema/source/actor/grant/ticket/ready/unblocked/time and literal limitation claim
are checked. An arbitrary local `approved: true` is never accepted. Freshness is
obtained after protected review, not baked into a catalog while CI is pending.

Job creation uses bounded metadata-only deleted-job inventory, official NOT_FOUND,
a durable FULL-synchronous SQLite claim before one POST, no overrides and no retry.
Unknown outcomes remain occupied across reopen. Recovery accepts only the operation
from that journal and validates an actual job GET. Run composes the existing
protected executor, rechecks the created UID in both fresh authority callbacks,
and uses its latest-etag/execution-inventory/single-task/zero-retry guards.
The RC47 sampler remains bound to main c572/image850/277 compiled files; RC48 main
825 and its release checks are a separate authority requirement, not retargeted
sampler bytes. Local payload validation rebuilds the exact protected bundle and
bootstrap; it does not qualify the actual compiled image or native invocation.

All new tests use synthetic GitHub/native/token/operator fixtures and temporary
journals. They never invoke gh, gcloud, OAuth, native SDK, a provider or PROD.
`observe-run` reconciles execution metadata only; it does not acquire or validate
the PRE/POST preservation stdout/report. Source-bound native output acquisition,
fresh backup/compatible apply/role acceptance remain separate. First real creation
and authentication require native qualification after all reviewed authority gates.
The exact historical pool raw pin is still unavailable, and historical native
evidence reports crm_runtime cannot SELECT `_prisma_migrations`; synthetic grants
do not fix that permission. Missing pins, native SQL failure or unknown result
must refuse. Never grant privileges, omit the ledger query, use crm_migrator,
replay an old helper, change roles or accept current state as a baseline here.
