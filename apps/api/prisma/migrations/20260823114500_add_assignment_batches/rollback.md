# Rollback local CRMY-131

Revenir au code précédent en conservant les tables additives inutilisées. Sur PostgreSQL éphémère uniquement, supprimer `assignment_batch_items` puis `assignment_batches`. Aucun rollback destructif n’est autorisé sur une base persistante.
