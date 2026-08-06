# Product Owner checklist before any Terraform apply

- [ ] The execution ticket and exact root module are approved.
- [ ] The reviewed commit and plan input commit are identical.
- [ ] Organization, folder parent, and all project IDs are rechecked.
- [ ] Capacity for four project creations is confirmed.
- [ ] Temporary human permissions identify principal, start, and expiry.
- [ ] The complete billing ID is injected securely and absent from logs.
- [ ] Real USD budget amounts are approved; no implicit MAD conversion exists.
- [ ] State backup and migration operators are identified.
- [ ] `tf-bootstrap` impersonators and IAM roles are reviewed.
- [ ] WIF repository, numeric IDs, refs, and GitHub Environments are rechecked.
- [ ] Fork and unauthorized-branch negative tests are planned.
- [ ] Rollback owner, evidence location, and stop conditions are recorded.
- [ ] CNDP follow-up remains assigned to the Product Owner without an automatic
      claim of legal compliance.
- [ ] A separate authorization explicitly permits the plan and apply.
