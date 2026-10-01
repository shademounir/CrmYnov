# Funnel commercial v1

`GET /reports/commercial-funnel` est réservé aux rôles Manager, Admin et Super Admin. Les scopes campus sont appliqués avant l’agrégation. La réponse ne contient aucun nom, email, téléphone ni identifiant métier de lead.

## Contrat des indicateurs

- Version : `commercial-funnel-v1`.
- Fuseau de présentation : `Africa/Casablanca`.
- La période sélectionne une cohorte par `createdAt`, avec borne initiale inclusive et borne finale exclusive.
- Chaque UUID de lead est compté une fois, dans son statut courant.
- `contactedOrBeyond = CONTACTED + QUALIFIED + ENROLLED`.
- `qualifiedOrBeyond = QUALIFIED + ENROLLED`.
- `enrolled = ENROLLED`.
- Chaque taux utilise le nombre total de leads uniques de la cohorte comme dénominateur et vaut `null` si la cohorte est vide.
- `CLOSED_LOST` n’est inclus dans aucun numérateur d’atteinte. Les taux décrivent une photographie courante et non les transitions historiques.

Les filtres `campus`, `campaign`, `program` et `source` sont combinables et exacts. L’audit conserve la version, le total et les noms des filtres actifs, jamais leurs valeurs.

## Vérification et rollback

Les tests utilisent exclusivement des leads synthétiques, y compris un jeu de 2 000 éléments. Le rollback applicatif consiste à retirer le contrôleur, le service et la page ; aucune migration ni donnée persistante n’est concernée.
