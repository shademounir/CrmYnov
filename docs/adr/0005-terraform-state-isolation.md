# ADR-0005 — Terraform state isolation

- Status: Accepted for code preparation

## Decision

Use four GCS buckets in the bootstrap project: Bootstrap, DEV, STAGING, and
PROD. Each has versioning, Uniform Bucket-Level Access, Public Access
Prevention, separate IAM, `prevent_destroy`, and no irreversible retention.

The first authorized bootstrap temporarily uses local state because the buckets
do not yet exist. Migration to GCS is immediate and human-verified. Local state
is deleted only after a separate human confirmation of remote state, backup,
lineage, serial, and access recovery.
