# Timeline locale des leads

La timeline est append-only : l'API expose `POST /leads/{leadId}/timeline` et `GET /leads/{leadId}/timeline`. Aucun endpoint de modification ou suppression n'existe. Les rôles Admissions, Admin et Super Admin peuvent ajouter une activité ; Auditor est limité à la lecture.

Les tests utilisent exclusivement des identités et coordonnées synthétiques. La migration CRMY-46 est additive et ne doit être exécutée que sur PostgreSQL éphémère en CI. Le rollback local documenté supprime les tables dans l'ordre dépendant, sans être applicable à une base persistante.
