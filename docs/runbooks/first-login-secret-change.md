# Changement du secret à la première connexion

Une session marquée `mustChangeSecret` ne peut appeler aucune route protégée par RBAC. Le seul parcours autorisé remplace le digest temporaire, révoque immédiatement toutes les sessions et écrit un événement d’audit sans valeur sensible. L’utilisateur doit ensuite se reconnecter.

Les adaptateurs Identity Platform et Secret Manager restent gelés. Cette tranche n’utilise que des secrets synthétiques en mémoire et une migration additive testée sur PostgreSQL éphémère. Le rollback applicatif conserve les colonnes additives.
