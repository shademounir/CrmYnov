# Reporting local persistant

Le reporting CRM est recalculé à chaque requête API après rechargement du cœur Lead et des demandes de réaffectation depuis PostgreSQL local. Le dashboard manager, sa vue personnelle et l’export agrégé partagent les mêmes filtres versionnés et le fuseau `Africa/Casablanca`.

## Source et périmètre

- Le chemin local ordinaire exige `DATABASE_URL` vers le PostgreSQL Docker local.
- Les leads et activités sont rechargés avant tout calcul afin d’éviter un cache de présentation obsolète.
- L’évidence persistante compte les leads distincts, rendez-vous, métadonnées documentaires et lots d’import avec le même périmètre campus et la même période.
- Les requêtes appliquent les scopes campus côté serveur. Une vue personnelle reste limitée au collaborateur authentifié.
- L’API n’expose que des agrégats ; aucune identité, donnée documentaire ou valeur d’import brute n’est ajoutée à l’export.

## Cohérence

Le dashboard, les drill-downs et l’export utilisent une normalisation de filtres unique. Les comptages de conversion restent distincts par lead et l’attribution primaire existante n’est pas modifiée. Les compteurs persistants constituent une preuve de source et non une seconde formule métier.

## Validation locale

Utiliser uniquement le seed synthétique et PostgreSQL local/éphémère. Vérifier le dashboard manager, la vue personnelle, l’export CSV, les filtres campus et conseiller, puis redémarrer l’API pour confirmer que les agrégats proviennent toujours de PostgreSQL.

Le mode `LOCAL_SYNTHETIC_FALLBACK` est réservé aux tests unitaires sans `DATABASE_URL` ; il ne doit pas être utilisé pour la recette persistante.
