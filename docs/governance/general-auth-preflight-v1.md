# Complete official AUTH preflight, separate from RUN

The additive NON-CLI entry `runProspectiveAuthPreflightV2` implements the direct
human AUTH-only decision following checkpoint v196. It does not renew GENERAL's
expired catalogue or its permanently closed prospective capability. The original
UNKNOWN journal and snapshot, Ledger FIN and closed prospective claim remain
byte-identical. Existing executor and RC47 auth-factory sources remain unchanged.

The concrete path checks exact input/qualification bytes, a clean protected source,
normal protected-merge governance, native Jira readiness and a fresh bounded lease.
It then creates an exclusive, fsynced AUTH-only attempt intent (not a RUN claim).
An existing intent is terminal even if a previous attempt failed before a token.
There is no adapter-initiated retry, alternate account, ADC fallback, second token
command/refresh after AUTH, or timeout escalation. The SDK's own normal internal
credential refresh/cache path is allowed by the narrow clarification below. Its
internal network activity is not instrumented: no claim of zero SDK-internal
network retries is made. Our adapter still invokes at most three commands and
stops on the first command or validation failure.

The immutable official SDK factory performs three sequential validations. Only the
internal process adapter changes the initial Windows execution cap from3s to5s;
the pinned-account config remains3s and the token command6s. Other supported OS
caps remain3/3/6s. Every call validates the original factory command/environment,
then uses the minimum of its cap and actually remaining shared15s, lease and
request budgets. Input validation and time spent inside the SDK chain consume the
same envelope. A timeout, elapsed deadline, guard refusal, malformed output, failed
process, missing spawn/close proof or factory validation refusal ends the attempt.

A timer firing is distinguished from an observed elapsed deadline and a source or
lease guard refusal. At most500ms of observation-only process cleanup can follow
failure; it never extends the AUTH acceptance deadline or permits another command.
Returned facts are stable snapshots, including whether close was observed. Late
success cannot override a failure. Receipts contain closed diagnostic categories,
never raw stdout/stderr, SDK config, environment, errors, tokens or token hashes.
Token references in OUR JavaScript adapter are released when AUTH_ONLY ends;
physical erasure of a JavaScript string is not asserted. This is NOT a promise that
the official SDK itself is memory-only: its normal credential/token refresh path
can update its standard internal cache. The direct human additive clarification
`58ed93bdeee323b5dd0ad0e3e8d15ee4509042f31c2773f214ea00db3897c3a1`
authorizes ONLY that standard SDK cache for the same one existing trial. Its exact
local receipt is checked before SDK use. It grants no additional attempt/retry,
credential-store inspection/export/copy/deletion/modification by our code, token
copy/display/persistence in our code or proofs, GCP-resource request or RUN right.
No actual cache writes are observed or asserted by the adapter. The original
human receipt remains unchanged. The opaque SDK token supplies no independent account
identity, expiration or IAM evidence. SDK-internal networking is not instrumented.

AUTH_ONLY ends before any rights/resource client, Cloud Run/Logging request,
private-key read, SQL, new execution capability, RUN INTENT or POST. The future
preclaim seam is exercised only with synthetic fixtures in this version:

1. inputs, source, Jira and lease;
2. complete official authentication;
3. qualified and actually observed rights and resource checks;
4. short revalidation;
5. exclusive durable future claim and intent;
6. one POST, then terminal completion or stop without retry.

The concrete future `runProspectiveGeneralPreV2` deliberately refuses until a
separate explicit RUN authority and qualified protected rights/resource adapter
exist. The documentary IAM matrix is neither an adapter nor current rights proof.
No new capability/window/directory or fake permission facts are allocated here.
This is not qualification of a new GENERAL collection or permission to collect,
deploy, activate Sheets, modify IAM, replay Ledger or resume the paused automation.
SQL freshness remains300000ms from actual transaction completion, not AUTH start.
