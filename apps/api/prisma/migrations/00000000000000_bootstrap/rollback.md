# Qualification du bootstrap historique immuable

Le SQL crée uniquement `system_probes` avec une clé primaire UUID et une date.
Il ne convertit ni ne supprime aucune donnée. Son empreinte est liée au document
`policy.json` ; aucun commentaire n'est ajouté au SQL déjà appliqué.

`ephemeral-only` désigne la cible des vérifications de politique, et non une
affirmation que cette migration n'a jamais été déployée. Les vérifications sont
effectuées sur PostgreSQL isolé, sans accès aux bases de recette ou cloud.

## Retour arrière

Revenir au code applicatif précédent et conserver la table et ses lignes.
Aucun down SQL automatique, aucune suppression de table ou de volume et aucune
modification de `_prisma_migrations`. Cette table additive ne rend pas le code
précédent incompatible. La création initiale prend des verrous DDL sur le nouvel
objet ; ne pas l'exécuter au milieu d'une transaction applicative concurrente.

Si une récupération de données devient nécessaire : arrêter les producteurs,
conserver un export final, restaurer la sauvegarde dans une base distincte,
vérifier son contenu puis arbitrer la bascule. Une archive lisible ne vaut pas
une restauration testée. Le test isolé `release-migration-postgres.test.mjs`
qualifie l'application du socle sur une base vide, la préservation d'une fixture
peuplée antérieure et une restauration réelle dans une troisième base.
Cela ne remplace pas les preuves spécifiques Cloud SQL ni un rollback PROD.
