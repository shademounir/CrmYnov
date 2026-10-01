# Température commerciale — stratégie de retour

Cette migration ajoute une table append-only vide. Elle ne qualifie aucun Lead existant et ne convertit aucune donnée Excel ou historique.

## Validation

Appliquer la migration sur une base PostgreSQL éphémère vide, puis sur un état antérieur contenant des Leads synthétiques. Vérifier les clés étrangères, les contrôles de température et de version, les deux contraintes d’unicité et la conservation des Leads existants.

## Désactivation et rollback applicatif

Retirer d’abord le parcours de modification de la version applicative et conserver la table ainsi que son historique. Une version antérieure ignore cette table additive.

Aucun rollback SQL destructif n’est proposé sur une base contenant des qualifications. La suppression de la table n’est acceptable que par destruction de la base éphémère appartenant au harnais de test ; elle ne doit jamais être exécutée sur la base de prévisualisation ou une base persistante utile.
