# Affectation manuelle unitaire et en lot — CRMY-131

Les opérations sont réservées à `MANAGER`, `ADMIN` et `SUPER_ADMIN`, bornées à 100 leads, confirmées explicitement et idempotentes. L’aperçu retourne `mutated=false`. Un lead déjà affecté est ignoré avec `lead_already_assigned` et doit suivre CRMY-94 ; aucune réaffectation silencieuse n’est possible.

Une cible fixe doit être active, non suspendue, non exclue et sous capacité. Les modes round-robin et aléatoire contrôlé réutilisent strictement la règle configurée ; une discordance de stratégie échoue. Chaque succès ajoute un événement `ASSIGNMENT_CHANGED` à la timeline et un audit expurgé.

La migration est additive et réservée à PostgreSQL éphémère en CI. Le rollback applicatif conserve les tables additives inutilisées. Aucun connecteur, secret, cloud, donnée réelle ou base persistante n’est impliqué.
