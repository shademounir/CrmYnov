# AUTH_ONLY: composed official Jira evidence V2

This additive compatibility profile is restricted to the already authorized
complete SDK authentication trial. It neither grants resource permissions nor
opens a RUN capability. The Jira V1 validator, GENERAL/RUN schemas, closed HOST
and claims, UNKNOWN evidence and Ledger FIN remain unchanged.

## Evidence, not a missing provider attestation

An explicitly versioned AUTH_ONLY authority record selects V2. V1 keeps its
exact schema and 52-file manifest; V2 binds its complete 58-file source closure.
There is no automatic V1-to-V2 fallback after refusal.

The new AUTH_ONLY record selects `jiraEvidenceVersion` explicitly: `2` for the
composed absent-context proof, or `1` for an actual provider-context observation
validated by the unchanged native V1 validator. This selection happens before
validation and is hash-bound in the authority record and marker. A refusal never
changes the selection. If the provider supplies a real invocation/account/tenant
context, preserve it under the V1 selection; do not erase it to manufacture an
absent-context V2 receipt. The additive composition remains available and tested
when provider context really is absent. Neither choice is admitted to RUN.
Selecting Jira V1 inside the new AUTH_ONLY record still binds all 58 source
inputs and the new qualification; it does not reuse a V1 source qualification.

V2 composes three separately observed official primary-connector reads:
`atlassianUserInfo`, `getAccessibleAtlassianResources`, and the explicit
`getJiraIssue` request for the pinned tenant and CRMY-63. Every minimized receipt
records the actual fully qualified tool, request, observed connector route,
request start and response receipt times. Account, tenant, ticket, readiness,
labels and dependencies must match their pinned bindings. Contradictory,
incomplete, mixed primary/legacy or unrelatable connection origins refuse.

When no provider invocation/context is returned, `providerInvocationId` remains
`null`. A `local:<uuid>` correlation is explicitly local. Matching the observed
bound connector route does not attest a common credential identity. Missing
provider context is not manufactured; present metadata must not be discarded
to pretend it was absent. No provider signature or atomic snapshot is claimed.

Hashes bind only the retained, minimized UTF-8 canonical JSON bytes, with sorted
keys and one trailing newline. Exact data-only objects and an aggregate 65536
byte bound reject ambiguous or incomplete inputs. No credentials, headers,
cookies, tokens or MFA codes are evidence. Old SHAPE-ONLY receipts cannot become
fresh observations by conversion or redating.

## Freshness and consumption boundary

The maximum 600000 ms age starts at the oldest real request start, including
call latency. Newer reads, composition, markers and records cannot restart it.
The effective lease is the minimum of that expiry, the operational marker and
the authority record. It is revalidated after governance and immediately before
the exclusive global AUTH intent. V2 does not change the 300000 ms SQL PRE rule.

`inspectProspectiveAuthOnlyReadiness` shares the actual entry's preparation but
creates no AUTH intent and invokes no SDK. The host must complete source CI,
normal protection, fresh Jira observations and readiness before consuming the
existing single entry/trial. A refusal reports only closed stage/guard codes,
an allowed Jira substage or a source path already in the fixed manifest; never
raw exception bodies. A preparation failure is not evidence of token expiry.

Windows SDK caps remain 5000/3000/6000 ms in one absolute 15000 ms envelope,
clamped to actual remaining time. There is no retry, fallback or automatic cap
increase. Only the separately authorized standard internal SDK cache may write;
our token reference stays in memory and is released without output or evidence
copy. Authentication does not prove Cloud Run, Logging or SQL rights.

## Qualification and governance

The new qualification profile binds protected base
`d123032cc46b5fc08fa524615e090c3fe8f3f313`, the exact two existing-file adaptations,
six added files, retained prior qualification and the narrow human-authority pin.
It requires unchanged other sources, root/targeted tests, static gates and
historical evidence hashes. Prior V1 qualification remains a distinct profile.
Technical CI, Sonar, real conversations, Jira, the protected delegation grant,
unique audit/decision, policy and normal protected merge remain mandatory.
An automatic Codex review is not a prerequisite. This source approval does not
authorize a native PRE, runtime deployment or Sheets activation.
