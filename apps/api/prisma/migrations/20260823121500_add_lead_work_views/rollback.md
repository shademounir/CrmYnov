# Rollback applicatif

Revenir au squash précédent désactive immédiatement les nouvelles vues et ignore les quatre colonnes additives. La base peut conserver ces colonnes sans impact sur l’ancienne application. Leur suppression éventuelle est destructive et exige une opération séparée en `manual-po`; elle n’est ni automatisée ni exécutée par cette migration.
