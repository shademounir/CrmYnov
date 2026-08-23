# Recherche, filtres, tri et pagination des leads

La route `GET /leads` combine `search`, `assignedToId`, `status`, `source`, `program`, `campaign`, `campus`, `createdFrom`, `createdTo`, `sortBy`, `sortDirection`, `page` et `pageSize`.

`search` couvre le code immuable du lead, le prénom, le nom, l’email et le téléphone. Les filtres sont cumulatifs, la pagination est bornée à 100 éléments et le tri est limité à une liste blanche avec le code lead comme départage déterministe. L’interface utilise un formulaire `GET` : l’URL est partageable et résiste au rafraîchissement.

Les événements d’audit ne conservent ni valeur recherchée, ni contact, ni donnée personnelle : uniquement les paramètres de pagination, le nombre de filtres, le tri et le nombre de résultats. Les index Prisma existants couvrent l’affectation/statut, le nom/code, et source/formation/date.

Rollback applicatif : revert protégé de la PR. Aucun rollback de base n’est requis, car cette livraison n’ajoute aucune migration.
