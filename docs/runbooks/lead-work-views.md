# Vues de travail Leads

`GET /leads` accepte `view=ALL|MINE|FOLLOW_UP|UNASSIGNED|NO_ACTIVITY|CLOSED`. `ALL` conserve la visibilité globale des rôles autorisés. `MINE` sélectionne la propriété directe ou une collaboration active. `FOLLOW_UP` exclut les clôtures, retient les échéances atteintes selon l’horodatage UTC du serveur et les trie de la plus ancienne à la plus récente. Les filtres existants restent combinables avec `assignmentMode` et `importBatchId`.

L’API contrôle le rôle et ne fait confiance à aucun identifiant utilisateur fourni pour la vue personnelle : l’identité vient exclusivement de la session. Les auditeurs conservent le masquage des coordonnées. Les tests et exemples sont synthétiques.

Rollback applicatif : revenir au squash précédent. Les colonnes additives peuvent rester en base ; toute suppression ultérieure est destructive et requiert une PR `manual-po` distincte.
