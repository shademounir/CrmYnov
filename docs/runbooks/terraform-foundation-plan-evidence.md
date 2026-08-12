# Terraform Foundation plan evidence

## Purpose

This chain turns an already-produced Terraform JSON plan into deterministic,
redacted evidence. It does not authorize a plan or any Google Cloud mutation.

The current wrapper is deliberately synthetic-only. A real plan must remain a
separate, Product Owner-authorized operation and must never be inferred from a
successful fixture run.

## Contract

`analyze-foundation-plan.mjs` reads exact UTF-8 bytes, hashes them with SHA-256,
parses Terraform JSON format `1.2`, recursively visits root and child modules,
and reconciles every planned address with `resource_changes`.

Success requires exactly:

- 31 creates, zero update/delete/replace/import;
- one folder, four projects, four billing bindings (`google_billing_project_info`), 17 enabled services, five
  budgets;
- USD budgets: bootstrap `8.330000000`, dev `41.670000000`, staging
  `33.330000000`, prod `100.000000000`, folder `183.330000000`.

Reads and no-ops are counted separately. Any malformed, ambiguous, unsupported,
or inconsistent representation fails closed. Failure output contains only a
stable code, category, and an allowlisted Terraform address when safe.

## Synthetic validation

```powershell
node scripts/terraform-plan/generate-fixtures.mjs
node --test scripts/terraform-plan/tests/*.test.mjs
powershell -NoProfile -File scripts/terraform-plan/run-foundation-plan.ps1 `
  -SyntheticFixture `
  -FixturePath scripts/terraform-plan/fixtures/foundation-positive.synthetic.json
```

The wrapper accepts only `*.synthetic.json` beneath its versioned fixture
directory, copies the file to an isolated temporary directory, invokes Node,
emits the redacted JSON summary, and deletes temporary evidence in `finally`.
The synthetic branch contains no Terraform or Google Cloud invocation. The real
parameter set is reserved for a later explicit authorization: it verifies the
expected `main` SHA, requires tfvars outside Git, uses the correctly positioned
global option `terraform -chdir="<root>"`, checks every native exit code and
artifact, and never provides apply, destroy, or import behavior.

## Future authorized evidence bundle

A later Product Owner authorization may define a separate real execution
wrapper. The retained evidence should bind the Terraform binary version,
provider selections, sanitized command exit codes, plan binary hash, JSON hash,
Git SHA, UTC timestamps, analyzer version, and redacted analyzer summary. Plan
binary and raw JSON retention must follow the approved restricted storage and
retention policy; neither belongs in Git or Jira.

## Incident root cause and correction

The retained execution record confirms two distinct failure boundaries. The
first cycle passed the literal value `$root` to Terraform and failed with
`Error handling -chdir option: chdir $root`; quoting `"-chdir=$root"` corrected
that global-option placement. Two IAM propagation cycles then preceded the
authorized attempt. In the final cycle, the result object shows `planCounts`,
`resourceCounts`, and `budgets` still null while `error` is also null. The old
script had no stage marker, did not assert that the binary or redirected JSON
existed and was non-empty, did not hash either artifact, wrote the summary only
from `finally`, and deleted all source evidence in that same `finally` block.
Consequently the exact statement at which PowerShell stopped is no longer
recoverable; the precise cause of *missing proof* is the non-atomic handoff plus
unconditional early destruction of the only diagnosable artifacts. Treating a
more specific parser or encoding failure as confirmed would fabricate evidence.
CRMY-120 removes that failure mode with explicit native exit checks, artifact
checks, UTF-8 normalization, hashes, a standalone fail-closed parser, and cleanup
only after the redacted summary is emitted. It does not reinterpret the prior
indeterminate plan as successful.

## Rollback

Revert the CRMY-120 commits through a protected pull request. Do not delete or
rewrite history. Keep CRMY-119 blocked and do not authorize a new Foundation
plan until the prior analyzer is restored or an equivalent reviewed chain is
available.
