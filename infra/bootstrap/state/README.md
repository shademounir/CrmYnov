# Bootstrap state buckets

This root describes four distinct GCS buckets in the bootstrap project. Every
bucket is versioned, private, protected from public access, guarded by
`prevent_destroy`, and has no irreversible retention policy.

The first creation is intentionally local and executed by the authorized
temporary institutional human. Migration to each GCS backend must follow
`docs/runbooks/terraform-state-migration.md`. Only after migration and access
validation may subsequent state operations use `tf-bootstrap`. Local state
deletion is a separate human decision after remote state verification and
backup.
