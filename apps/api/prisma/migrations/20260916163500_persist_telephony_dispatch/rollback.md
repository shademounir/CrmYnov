# Rollback

Only after exporting the affected call evidence and confirming that no application
version still reads these columns:

```sql
ALTER TABLE "telephony_calls"
  DROP COLUMN "dispatch_updated_at",
  DROP COLUMN "dispatch_error_code",
  DROP COLUMN "dispatch_state";
```

This removes command-dispatch evidence and is therefore intentionally manual.
