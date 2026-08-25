# Rollback applicatif

Cette migration crée uniquement trois tables additives et leurs index. Le rollback normal consiste à revenir au code précédent en laissant ces tables inutilisées. Sur une base PostgreSQL éphémère exclusivement, la base entière peut être recréée afin de vérifier le retour arrière. Aucune suppression de table ni mutation de données n'est autorisée automatiquement sur une base persistante.
