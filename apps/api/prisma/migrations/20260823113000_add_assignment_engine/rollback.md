# Rollback local CRMY-130

Le rollback applicatif consiste à revenir au code précédent. Les trois tables additives restent présentes mais inutilisées afin de conserver la traçabilité. Sur PostgreSQL éphémère uniquement, elles peuvent être supprimées dans l’ordre `assignment_decisions`, `assignment_rule_candidates`, `assignment_rules`. Aucune suppression n’est autorisée sur une base persistante.
