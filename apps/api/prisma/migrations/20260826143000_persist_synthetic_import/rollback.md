# Rollback local CRMY-154

Cette migration additive peut être annulée uniquement sur la base PostgreSQL locale éphémère de test avec :

```sql
ALTER TABLE "ingestion_batches" DROP COLUMN "fingerprint";
```

Cette procédure n'est pas autorisée sur une base persistante, STAGING ou PROD.
