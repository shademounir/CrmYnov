# DEV runtime state bootstrap

This one-time root creates only the versioned, private Terraform state bucket
for the CRM Ynov DEV runtime. It is deliberately separate because a backend
cannot safely create the bucket that stores its own state.

The initial apply uses the authenticated institutional human and local bootstrap
state. Back up that small state immediately, initialize `infra/environments/dev`
against the resulting GCS bucket, verify the remote state, then add only the
exact deploy service account as `roles/storage.objectAdmin`. This exception does
not authorize local state for the runtime root, another project, or a replacement
Workload Identity pool. Never delete the bootstrap state until remote access and
the retained backup are proven.
