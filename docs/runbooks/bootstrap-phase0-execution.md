# Phase 0 bootstrap — future execution runbook

Status: **code-only; real execution forbidden until a separate Product Owner authorization**.

## Purpose and ownership

Phase 0 prepares the existing four-project architecture by creating
`crmynov-bst-n7x4q2`; it does not add a seed project. ADR-0006 assigns the
bootstrap project, billing link, and three minimal services exclusively to the
`infra/bootstrap/phase0` Terraform state. Foundation never owns that project.

## Closed API allowlist

| API | Phase | Rationale |
|---|---|---|
| `cloudresourcemanager.googleapis.com` | Phase 0 mandatory | Project lifecycle and later parent move |
| `cloudbilling.googleapis.com` | Phase 0 mandatory | Attach the approved billing account |
| `serviceusage.googleapis.com` | Phase 0 mandatory | Enable and verify the closed service allowlist; quota project use relies on Service Usage |
| `billingbudgets.googleapis.com` | Phase 1 only | Five budgets are owned by Foundation |
| `iam.googleapis.com` | Phase 1 only | Bootstrap identities are introduced after Foundation |
| `iamcredentials.googleapis.com` | Phase 1 only | WIF service-account impersonation is not required to create Phase 0 |
| `sts.googleapis.com` | Phase 1 only | Token exchange belongs to WIF/OIDC |
| `storage.googleapis.com` | Phase 1 only | Remote Terraform state is prepared after bootstrap |

Official references:

- [Create and manage projects](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects)
- [Enable and disable services](https://docs.cloud.google.com/service-usage/docs/enable-disable)
- [Cloud Billing project linkage](https://docs.cloud.google.com/billing/docs/how-to/modify-project)
- [ADC quota-project troubleshooting](https://docs.cloud.google.com/docs/authentication/troubleshoot-adc)

## Contract inputs

The approved organization ID, project ID, region, labels, API allowlist, human
identity, and exact Git SHA are mandatory. The billing account is supplied only
through an ephemeral execution channel and is represented in evidence by a
boolean. A future execution must verify project absence and identity before any
mutation.

## Code-only verification

```powershell
node scripts/bootstrap-phase0/run-phase0.mjs --mode SyntheticFixture --fixture scripts/bootstrap-phase0/fixtures/positive.synthetic.json
node scripts/bootstrap-phase0/run-phase0.mjs --mode ContractSimulation --fixture scripts/bootstrap-phase0/fixtures/positive.synthetic.json
```

`--mode Real` deliberately returns `real_mode_disabled`. The current wrapper
does not invoke `gcloud` or Terraform. It uses an exclusive local lock and
removes it deterministically.

## Future authorized sequence

1. Confirm a clean reviewed SHA and acquire a single-attempt lock.
2. Verify identity, organization, project-ID availability, billing entitlement,
   and the exact API allowlist without displaying credentials.
3. Configure a dedicated Phase 0 remote state prefix.
4. Obtain explicit approval for a Phase 0 plan and then for apply; these are
   distinct approvals.
5. Verify the project, billing boolean, three enabled APIs, and redacted proof.
6. Configure the local ADC quota project only after a separate authorization.
7. Run Foundation Phase 1 with the bootstrap project as an external input.
8. After the folder exists, request approval to update Phase 0 with the folder
   ID so the same state moves the project non-destructively.

No step permits a service-account key. WIF/OIDC remains the target identity
model. Exact future commands intentionally remain outside this code-only
delivery to prevent accidental execution.
