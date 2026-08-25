# Cœur Lead persistant local

CRMY-152 remplace le chemin API en mémoire par des repositories Prisma dès que
`DATABASE_URL` désigne le PostgreSQL local. Sans cette variable, les doubles en
mémoire restent disponibles uniquement pour les tests unitaires isolés.

## Agrégats couverts

- Lead, statut courant, affectataire principal et collaborateurs actifs ;
- timeline append-only, y compris corrections compensatoires ;
- demandes de réaffectation, collaboration et clôture avec version optimiste ;
- reçus de mutation idempotents, associés à une empreinte SHA-256 expurgée ;
- pagination, vues, recherche, filtres et tri déterministes après hydratation.

La création et chaque mutation du Lead mettent à jour la version optimiste,
ajoutent les activités nouvelles et enregistrent le reçu d'idempotence dans une
transaction PostgreSQL `Serializable`. Un rejeu avec la même clé et la même
empreinte rend le résultat mémorisé ; une empreinte différente ou une version
périmée échoue fermée. Une correction de timeline ajoute un événement : elle ne
réécrit jamais l'événement d'origine.

Les décisions de réaffectation, collaboration et clôture vérifient également
l'état `PENDING` et la version attendue. Les contrôles RBAC, ownership, campus,
anti-IDOR et séparation des tâches restent dans les services métier avant toute
écriture.

## Validation locale et CI

```powershell
npm ci
npm run prisma:generate --workspace @crm/api
npm run prisma:validate --workspace @crm/api
npm run type-check --workspace @crm/api
npm test --workspace @crm/api -- --runInBand
```

La migration `20260825123000_persist_lead_core` est additive. Elle est auditée
statiquement puis appliquée uniquement sur le service PostgreSQL éphémère de la
CI. Aucun fichier d'import réel, secret, PII, URL distante ou donnée persistante
n'est utilisé.

## Limites et rollback

CRMY-153 persistera les interactions/outbox et CRMY-154 les provenances
d'import avec leur lot. CRMY-152 ne déclenche donc aucun import ni livraison
externe. Le rollback applicatif consiste à reverter la PR et à recréer la base
éphémère. Les tables ou colonnes additives ne sont jamais supprimées d'une base
persistante par ce runbook ; une telle opération serait destructive et
`manual-po`.
