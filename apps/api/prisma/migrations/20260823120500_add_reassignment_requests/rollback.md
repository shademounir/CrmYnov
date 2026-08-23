# Rollback local CRMY-94

Revenir au code précédent en conservant la table additive afin de préserver les décisions. Sur PostgreSQL éphémère uniquement, la table peut être supprimée avec la base jetable. Aucune suppression ou réécriture d’historique n’est autorisée sur une base persistante.
