# Rollback applicatif CRMY-169 — responsabilités TEAM

Migration additive sur table nouvelle et vide ; aucune inférence depuis teamId,
aucune migration de données. Validation uniquement sur PostgreSQL éphémère.
Les anciennes appartenances ne deviennent jamais des responsabilités Manager.

Pour revenir sur une responsabilité, enregistrer active=false avec la version
attendue dans la commande auditée. Conserver la table et son audit, sans DROP.
En cas de panne, TEAM est refusé ; ne pas rétablir une déduction implicite.
