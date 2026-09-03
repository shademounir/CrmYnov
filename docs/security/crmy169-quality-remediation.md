# CRMY-169 — refactorisation ciblée de complexité

## Référence et limites

Référence avant correction : `b037fa47a94000d218d53684d686b72f794a3a4e`, PR89, manual-po. Aucun contrat API, migration, seuil/profil/exclusion Sonar, workflow ou règle de permissions modifié. CRMY-54 reste au préflight. Les résultats Sonar du nouveau head doivent être relus après push ; les mesures locales ne constituent pas ce gate distant.

## Inventaire des quatre Critical S3776

| Fichier | Fonction (ancienne ligne) | Avant → après local | Seuil | Responsabilité | Refactorisation |
|---|---|---:|---:|---|---|
| dynamic-context.ts | currentPrincipal (10) | 16 → 4 | 15 | Identité/session et scopes relus côté serveur | currentCampusScopes (complexité 6) sépare la résolution des alias campus ; ordre et valeurs conservés |
| dynamic-repository.ts | transaction (13) | 19 → 5 | 15 | Fence Serializable, unicité du traitement, erreurs fermées | retryFenceOrThrow (6) sépare la classification d'erreur de l'exécution ; cinq tentatives maximum, jamais de rejeu après entrée métier |
| dynamic-resources.ts | routeContexts (32) | 17 → 11 | 15 | Ressources/identifiants serveur, périmètre campus | requestedCampuses (4) et principalCampuses (1) isolent la sélection et le fallback autorisé ; priorité des branches inchangée |
| app/admin/roles/page.tsx | RolesPage (9) | 19 → 12 | 15 | Orchestration de l'écran, non autorité de sécurité | ConfigurationSelector (2) et OperationFeedback (3) isolent deux responsabilités de présentation |

Mesures locales : règle officielle S3776 de eslint-plugin-sonarjs 4.2.0 dans un outil temporaire hors dépôt, calculée sur le code ancien puis nouveau. Les quatre chiffres anciens reproduisent exactement Sonar. Aucun helper extrait ne dépasse 15. Le seuil du dépôt et de Sonar reste 15 ; l'outil de mesure ne modifie aucune configuration CI.

Branches responsables dans l'ancien head (lignes Sonar) :

- currentPrincipal : refus session/identité 13, rôles 14, GLOBAL 16, campus 17, lookup 19, imbrication campus/boucle/alias 20, équipe 22.
- transaction : transaction imbriquée 15, absence fournisseur 17, boucle 18, catch 30, exception HTTP 31, lecture code 32, retry 35, conflits 36.
- routeContexts : source serveur 33, lead 35, body 37, batch 38–39, réservées 42, records 44, validation 46, sélection 47, fallback 48–50, absence campus 54.
- RolesPage : editable 31, feedback 53, sélecteurs 55, configuration 56, aperçu 60, restauration 62, explication 64 et équipe 65.

Couverture Sonar avant (fichier complet nouveau code de la PR) :

| Fichier | Lignes | Branches/conditions |
|---|---:|---:|
| dynamic-context.ts | 100 % (45/45) | 87,50 % (42/48) |
| dynamic-repository.ts | 100 % (68/68) | 77,55 % (38/49) |
| dynamic-resources.ts | 84,75 % (50/59) | 71,93 % (41/57) |
| page.tsx | 100 % (69/69) | 83,78 % (62/74) |

## Caractérisation et invariants

Avant refactorisation : 40 tests ciblés API/sécurité et 7 Web, tous verts sans skip. Après : mêmes tests et 10 nouveaux tests de frontière transactionnelle, soit 50 API/sécurité et 7 Web ciblés verts. Les nouveaux tests de frontière n'ouvrent aucun client Prisma ni connexion ; les preuves de rollback réel viennent des tests PostgreSQL/HTTP distincts.

| Règles PO | Preuves avant/après |
|---|---|
| NONE ne retire pas un autre grant ; cumul | dynamic-permissions : NONE, union indépendante |
| Global désactivé, campus restreint, aucune élévation | dynamic-permissions : NONE explicite, scopes incomparables ; PostgreSQL admin boundaries |
| TEAM avec responsabilité persistée, absence/retrait | PostgreSQL fresh identity/current TEAM et production HTTP ; aucune inférence depuis navigateur |
| OWN principal/collaborateur actif/retrait | PostgreSQL fresh identity et filtrage de liste avant pagination |
| AUDITOR seul/multi-rôle, source des grants | dynamic-permissions ; DOM toggles ; explication multi-rôle |
| Permission/portée inconnue, fournisseur indisponible | validation fermée, PermissionService, panne DOM/HTTP |
| Multi-instance sans cache permissif | deux API réelles, session conservée et retrait appliqué à la requête suivante |
| Version périmée, rollback, restauration | PostgreSQL concurrent winner, rollback grants/écriture métier, nouvelle version et historique |
| Dernier Super Admin, audit exact, aucune mutation partielle | PostgreSQL protection atomique et audit/version immuables |
| Retry limité, pas de double effet métier | dynamic-repository-retry : deux conflits pré-handler puis un effet ; limite cinq ; P2034/P2002/P2025 après handler jamais rejoués ; HTTP préservé ; panne inconnue expurgée |

Le calcul des grants, les plafonds, la délégation Admin, les invariants AUDITOR, la restauration versionnée et la protection du dernier Super Admin ne sont pas déplacés ni dupliqués. Le resolver TEAM/OWN n'est pas modifié. Les limites métier restent des contrôles supplémentaires.

## Examen des 31 autres constats initiaux

Les numéros de ligne ci-dessous se réfèrent au head initial. Aucun ticket de dette n'est créé par cette remédiation.

| Règle | Sévérité | Fichier:ligne | Traitement/justification | Risque/suivi |
|---|---|---|---|---|
| plsql:VarcharUsageCheck | MAJOR | apps/api/prisma/migrations/20260902170000_dynamic_role_permissions/migration.sql:6 | Conservé : PostgreSQL utilise VARCHAR ; VARCHAR2 Oracle n'est pas une correction compatible. Migration inchangée. | Règle de dialecte ; suivi proposé, non créé. |
| plsql:VarcharUsageCheck | MAJOR | apps/api/prisma/migrations/20260902170000_dynamic_role_permissions/migration.sql:7 | Conservé : PostgreSQL utilise VARCHAR ; VARCHAR2 Oracle n'est pas une correction compatible. Migration inchangée. | Règle de dialecte ; suivi proposé, non créé. |
| plsql:VarcharUsageCheck | MAJOR | apps/api/prisma/migrations/20260902170000_dynamic_role_permissions/migration.sql:8 | Conservé : PostgreSQL utilise VARCHAR ; VARCHAR2 Oracle n'est pas une correction compatible. Migration inchangée. | Règle de dialecte ; suivi proposé, non créé. |
| plsql:VarcharUsageCheck | MAJOR | apps/api/prisma/migrations/20260902170000_dynamic_role_permissions/migration.sql:9 | Conservé : PostgreSQL utilise VARCHAR ; VARCHAR2 Oracle n'est pas une correction compatible. Migration inchangée. | Règle de dialecte ; suivi proposé, non créé. |
| plsql:VarcharUsageCheck | MAJOR | apps/api/prisma/migrations/20260902170000_dynamic_role_permissions/migration.sql:14 | Conservé : PostgreSQL utilise VARCHAR ; VARCHAR2 Oracle n'est pas une correction compatible. Migration inchangée. | Règle de dialecte ; suivi proposé, non créé. |
| plsql:VarcharUsageCheck | MAJOR | apps/api/prisma/migrations/20260902170000_dynamic_role_permissions/migration.sql:22 | Conservé : PostgreSQL utilise VARCHAR ; VARCHAR2 Oracle n'est pas une correction compatible. Migration inchangée. | Règle de dialecte ; suivi proposé, non créé. |
| plsql:VarcharUsageCheck | MAJOR | apps/api/prisma/migrations/20260902170000_dynamic_role_permissions/migration.sql:23 | Conservé : PostgreSQL utilise VARCHAR ; VARCHAR2 Oracle n'est pas une correction compatible. Migration inchangée. | Règle de dialecte ; suivi proposé, non créé. |
| plsql:VarcharUsageCheck | MAJOR | apps/api/prisma/migrations/20260902170000_dynamic_role_permissions/migration.sql:31 | Conservé : PostgreSQL utilise VARCHAR ; VARCHAR2 Oracle n'est pas une correction compatible. Migration inchangée. | Règle de dialecte ; suivi proposé, non créé. |
| plsql:VarcharUsageCheck | MAJOR | apps/api/prisma/migrations/20260902170200_team_responsibilities/migration.sql:8 | Conservé : PostgreSQL utilise VARCHAR ; VARCHAR2 Oracle n'est pas une correction compatible. Migration inchangée. | Règle de dialecte ; suivi proposé, non créé. |
| typescript:S3358 | MAJOR | apps/api/src/permissions/dynamic-contract.ts:22 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S3358 | MAJOR | apps/api/src/permissions/dynamic-contract.ts:22 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S7765 | MINOR | apps/api/src/permissions/dynamic-contract.ts:42 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S7776 | MINOR | apps/api/src/permissions/dynamic-contract.ts:49 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S3358 | MAJOR | apps/api/src/permissions/dynamic-evaluator.ts:61 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S6582 | MINOR | apps/api/src/permissions/dynamic-resources.ts:11 | Corrigé : garde campus avec chaînage optionnel, même court-circuit. | Faible, tests de refus campus. |
| typescript:S7776 | MINOR | apps/api/src/permissions/dynamic-service.ts:166 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S7776 | MINOR | apps/api/src/permissions/dynamic-teams.ts:12 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S6759 | MINOR | apps/web/app/admin/roles/layout.tsx:4 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S4624 | MAJOR | apps/web/app/admin/roles/page.tsx:24 | Corrigé dans la séparation présentation/opérations ; template, nommage, sorties natives et accolades explicites. | Faible, DOM et Playwright. |
| typescript:S7718 | MINOR | apps/web/app/admin/roles/page.tsx:28 | Corrigé dans la séparation présentation/opérations ; template, nommage, sorties natives et accolades explicites. | Faible, DOM et Playwright. |
| typescript:S7718 | MINOR | apps/web/app/admin/roles/page.tsx:38 | Corrigé dans la séparation présentation/opérations ; template, nommage, sorties natives et accolades explicites. | Faible, DOM et Playwright. |
| typescript:S6819 | MAJOR | apps/web/app/admin/roles/page.tsx:53 | Corrigé dans la séparation présentation/opérations ; template, nommage, sorties natives et accolades explicites. | Faible, DOM et Playwright. |
| typescript:S6819 | MAJOR | apps/web/app/admin/roles/page.tsx:53 | Corrigé dans la séparation présentation/opérations ; template, nommage, sorties natives et accolades explicites. | Faible, DOM et Playwright. |
| typescript:S2681 | MAJOR | apps/web/app/admin/roles/page.tsx:63 | Corrigé dans la séparation présentation/opérations ; template, nommage, sorties natives et accolades explicites. | Faible, DOM et Playwright. |
| typescript:S6759 | MINOR | apps/web/app/admin/roles/permission-editor.tsx:4 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S6759 | MINOR | apps/web/app/admin/roles/permission-evidence.tsx:3 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S6759 | MINOR | apps/web/app/admin/roles/permission-evidence.tsx:6 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S6759 | MINOR | apps/web/app/admin/roles/permission-evidence.tsx:9 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S6759 | MINOR | apps/web/app/admin/roles/team-responsibilities.tsx:5 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S7718 | MINOR | apps/web/app/admin/roles/team-responsibilities.tsx:16 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |
| typescript:S6819 | MAJOR | apps/web/app/admin/roles/team-responsibilities.tsx:22 | Conservé : hors des quatre fonctions refactorisées ; pas de changement opportuniste des contrats ou composants voisins. | Lisibilité/maintenance ; suivi regroupé proposé, non créé. |

## Livraison et rollback

Commit normal et nouveau contrôle SHA-bound requis ; PR Draft, sans label ni décision PO, sans Ready ni merge. Les trois migrations additives de la PR restent strictement inchangées. Aucun test n'utilise une base distante, une donnée réelle ou un secret réel.

Le rollback de cette refactorisation serait un revert ciblé du commit, sans migration ni manipulation de données, suivi des tests et d'une nouvelle revue manual-po. Il réintroduirait les constats de complexité ; privilégier une correction en avant. Ne jamais revenir automatiquement au fournisseur statique.
