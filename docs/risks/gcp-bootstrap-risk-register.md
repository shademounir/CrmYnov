# GCP bootstrap risk register

| ID | Risk | Current control | Residual decision |
|---|---|---|---|
| GCP-01 | Folder creation permission absent | Temporary folderCreator documented | Approve principal and expiry before apply |
| GCP-02 | Four-project quota unknown | No creation attempted; preflight records uncertainty | Confirm through quota support or authorized creation window |
| GCP-03 | Project IDs may exist but be invisible | Read-only probes returned not found or not visible | Recheck immediately before apply |
| GCP-04 | Billing currency differs from MAD assumptions | Currency read as USD; amounts have no defaults | PO approves real USD amounts |
| GCP-05 | Temporary Owner persists | 24-hour runbook and incident threshold | Record removal evidence |
| GCP-06 | WIF claim bypass | Exact repository and numeric IDs, ref, Environment | Test negative claims before activation |
| GCP-07 | State loss or disclosure | Four private versioned buckets and migration runbook | Human verification before local deletion |
| GCP-08 | Excessive Terraform IAM | Explicit role matrix; no basic roles | Review roles against actual Phase 0/1 calls |
| GCP-09 | CNDP status inferred automatically | Documentary checklist only | PO tracks formalities independently |
| GCP-10 | Public repository disclosure | Synthetic examples, secret/history scans | Keep execution values outside Git and PR logs |

Formalités CNDP suivies par le Product Owner. La documentation du projet ne
constitue pas une validation juridique automatique de conformité.
