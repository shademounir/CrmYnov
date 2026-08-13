# Terraform Foundation plan evidence

## Purpose and authorization boundary

The CRMY-121 wrapper binds a Foundation plan to deterministic, redacted
evidence. It does not authorize a real plan or any Google Cloud mutation.
`-RealExecution` must only be used after a new, explicit Product Owner
authorization. The code-only CI uses fixtures and a fake Terraform executable;
it has no secret, OIDC permission, cloud authentication, or network dependency.

The evidence chain is:

```text
Git SHA -> binary plan SHA-256 -> JSON SHA-256 -> analyzer result
```

## Modes

### Synthetic fixture

`-SyntheticFixture` accepts only a versioned `*.synthetic.json` file under the
fixture allowlist. It invokes the analyzer but no Terraform command. The result
uses `null` for the binary plan hash with status `synthetic_not_produced`; every
Terraform exit-code entry records `executed=false` and reason
`synthetic_fixture` rather than inventing code zero.

```powershell
powershell -NoProfile -File scripts/terraform-plan/run-foundation-plan.ps1 `
  -SyntheticFixture `
  -FixturePath scripts/terraform-plan/fixtures/foundation-positive.synthetic.json
```

### Contract simulation

`-ContractSimulation` exercises the complete real path with the versioned fake
Terraform executable. It verifies quoting, a root containing spaces,
`TF_DATA_DIR`, command ordering, hashes, exit codes, redaction, and cleanup
without executing Terraform or contacting a cloud.

The fake supports only the test harness and must never be supplied to
`-RealExecution` operationally.

### Real execution

`-RealExecution` requires all of the following explicit inputs:

- canonical repository and Terraform root paths;
- a non-empty tfvars source outside the repository;
- the audited 40-character Git SHA;
- optional, validated temporary parent;
- Terraform executable (defaults to `terraform`).

This mode is unavailable procedurally without a separate Product Owner
authorization. A successful code-only or contract-simulation run is not an
authorization.

## Ordered native contract

The wrapper uses `Set-StrictMode -Version Latest`, an argument array, and the
central `Invoke-NativeChecked` function. It never uses `Invoke-Expression` or a
command assembled as an executable string. The exact Terraform order is:

1. `terraform -chdir=<canonical-root> version`
2. `terraform -chdir=<canonical-root> fmt -check -diff`
3. `terraform -chdir=<canonical-root> init -backend=false -input=false -lockfile=readonly`
4. `terraform -chdir=<canonical-root> validate -no-color`
5. `terraform -chdir=<canonical-root> plan -input=false -no-color -out=<temporary-plan> -var-file=<temporary-tfvars>`
6. `terraform -chdir=<canonical-root> show -json <temporary-plan>`
7. versioned Node analyzer

Each native invocation captures stdout and stderr in the isolated temporary
directory, records `$LASTEXITCODE` immediately, and emits only stable errors.
There is one plan call and no behavior for apply, destroy, import, target,
refresh-only, or auto-approve.

## Temporary data and cleanup

The wrapper creates a GUID-bound `crmynov-evidence-*` directory outside the
repository. It rejects the repository, its descendants, a volume root, and the
user-profile root as temporary parents. The directory contains:

- dedicated `TF_DATA_DIR`;
- copied temporary tfvars;
- binary plan and JSON;
- native stdout/stderr files;
- analyzer output.

The previous `TF_DATA_DIR` value is restored exactly in `finally`; if no value
existed, only the wrapper-created environment variable is removed. Hashes and
the redacted in-memory summary are produced before cleanup. Deletion is limited
to the exact GUID-bound directory and is revalidated immediately before
removal. Cleanup failure makes the global result invalid.

## Evidence and redaction

Success returns schema version 2, UTC time, Git SHA, Terraform/provider
versions, plan and JSON sizes and SHA-256 hashes, complete executed-stage exit
codes, and the analyzer's redacted action/resource/budget contract.

Central redaction protects known tfvars values, billing-account patterns,
Authorization values, tokens, passwords, private-key markers, email addresses,
and personal paths. Native output, raw Terraform JSON, the binary plan, tfvars,
and command arguments are never returned. Synthetic billing and token
sentinels make tests fail if they reappear in wrapper stdout, stderr, summaries,
or recorded arguments.

## Expected Foundation contract

Success requires exactly:

- 26 indicative creates and zero update/delete/replace/import; this synthetic
  contract is not proof of a future real plan;
- one folder, three projects, three `google_billing_project_info`, 14 project
  services, and five budgets;
- USD budgets: bootstrap `8/330000000`, dev `41/670000000`, staging
  `33/330000000`, prod `100/0`, folder `183/330000000`.

## Tests

```powershell
npm run test:terraform-plan
npm audit --omit=dev
npm run security:scan
npm run security:history
```

The Windows contract suite covers the ordered success path, root paths with
spaces, `TF_DATA_DIR` isolation/restoration, all native failures, absent or
empty artifacts, truncated/non-conforming JSON, evidence hashes, complete exit
codes, Git/tfvars/path validation, redaction sentinels, exactly one plan call,
and cleanup after success and failure. The fake executable contains no cloud or
network command.

## Stable failures

The public failure contract contains only `valid=false`, `errorCode`, `stage`,
an optional exit code, artifact presence, and cleanup state. Stable codes
include `git_sha_mismatch`, `unsafe_temp_path`, Terraform stage failures,
missing/empty artifacts, `analyzer_failed`, `evidence_hash_failed`,
`cleanup_failed`, and `sensitive_output_detected`.

## Rollback

Before merge, close the pull request and delete the branch. After merge, use a
protected revert pull request; never reset, amend, force-push, or rewrite
history. No Google Cloud rollback is required because this delivery performs no
real plan, IAM grant, authentication, or cloud mutation.
