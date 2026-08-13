# Bootstrap Phase 0 — future execution runbook

Status: **code-only; every real step below requires a separate Product Owner authorization**.

## Invariant

`crmynov-bst-n7x4q2` is one of the four permanent projects. No seed/quota project is added. Foundation Phase 1 only reads it. ADR-0006 assigns its durable Terraform ownership to the dedicated Phase 0 state after import.

## Phase 0A — create only the project

Preflight must confirm the exact human identity, organization `1046537507934`, globally available project ID and single-attempt lock. A separately authorized procedure then creates only `crmynov-bst-n7x4q2`.

Forbidden in 0A: quota configuration, Foundation, billing link, CRM folder, other project, service-account key, API beyond unavoidable platform defaults.

## Phase 0B — adopt the project

Before import, verify:

- project exists and ID is exact;
- organization is exact and lifecycle is `ACTIVE`;
- no Phase 1 or historical Terraform state contains the project;
- target address is exactly `google_project.bootstrap`;
- `deletion_policy = "PREVENT"` and `auto_create_network = false` cannot cause replacement.

Import requires its own explicit authorization. A plan before successful import is prohibited. The current code never executes import.

## Phase 0C — quota, APIs and billing

### API bootstrap contract

| API | Why it is needed | Initial activation | Durable ownership |
|---|---|---|---|
| `serviceusage.googleapis.com` | Manage/inspect enabled services; quota project use requires the IAM permission `serviceusage.services.use` | Controlled procedure before ADC quota and first plan | Import `google_project_service.phase0[...]` into Phase 0 |
| `cloudresourcemanager.googleapis.com` | Verify project lifecycle, organization and later parent | Controlled procedure before first plan | Import into Phase 0 |
| `cloudbilling.googleapis.com` | Read and attach project billing | Controlled procedure before first plan | Import into Phase 0 |

No cloud API configures the local ADC quota field itself. The local ADC procedure writes that setting, while the identity must have `serviceusage.services.use` on the existing project before doing so. All three services must be active before the first Phase 0 plan because that plan inspects their state and the project/billing resources. Each activation is imported into its exact Phase 0 resource address before plan; Terraform must not report it as a creation.

Phase 1 alone owns `billingbudgets.googleapis.com`, `iam.googleapis.com`, `iamcredentials.googleapis.com`, `sts.googleapis.com`, and `storage.googleapis.com` for its disjoint resources.

After project and service imports, configure the local ADC quota project only under separate approval, inject the billing account outside Git, and produce a Phase 0 plan JSON. The plan must refuse delete/replacement/import and be reviewed before any apply.

Official references:

- [Create and manage projects](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects)
- [Enable and disable services](https://docs.cloud.google.com/service-usage/docs/enable-disable)
- [Cloud Billing project linkage](https://docs.cloud.google.com/billing/docs/how-to/modify-project)
- [ADC quota-project troubleshooting](https://docs.cloud.google.com/docs/authentication/troubleshoot-adc)

## Phase 1

Foundation uses `data.google_project.bootstrap`; it never creates or imports the bootstrap. It creates the folder, DEV/STAGING/PROD, their billing links, disjoint services, and five budgets. A later authorized Phase 0 change may move the bootstrap to the folder using the same state.

## Indicative counters

| Stage | Indicative value | Nature |
|---|---:|---|
| Phase 0A | 1 project | Procedural creation, not a plan action |
| Phase 0B | 1 import | Project adoption |
| Phase 0C before plan | 3 imports | Adoption of preactivated services |
| First Phase 0 plan after imports | 1 create | Expected billing link only; not proven |
| Phase 0 changes | Unknown | Must come from real JSON |
| Phase 1 plan | 26 creates | Synthetic contract only |
| Consolidated managed target | 31 resources | 5 Phase 0 + 26 Phase 1 |

No number is authoritative until the corresponding real plan JSON is validated.

## Code-only verification

```powershell
node scripts/bootstrap-phase0/run-phase0.mjs --mode SyntheticFixture --fixture scripts/bootstrap-phase0/fixtures/positive.synthetic.json
node scripts/bootstrap-phase0/run-phase0.mjs --mode ContractSimulation --fixture scripts/bootstrap-phase0/fixtures/positive.synthetic.json
```

`--mode Real` returns `real_mode_disabled`. The current wrapper invokes neither `gcloud` nor Terraform and removes its exclusive local lock deterministically.
