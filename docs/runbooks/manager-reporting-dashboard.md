# Tableau de bord Manager/Admin

Le contrat `manager-dashboard-v1` compose les cinq rapports versionnés via `GET /reports/manager-dashboard`. Les filtres `from`, `to` et `campus` sont propagés à chaque panneau ; le périmètre RBAC de l’appelant reste l’autorité finale.

Les cartes, tendances journalières, répartitions et tableaux utilisent des comptages distincts par lead dans le fuseau `Africa/Casablanca`. `GET /reports/manager-dashboard/export` expose uniquement les agrégats KPI, tendances et répartitions ; aucun identifiant de lead ou de collaborateur n’est exporté. Les états vide, chargement et erreur sont explicites et accessibles.

Les conversions ne sont attribuées qu’au responsable principal. Les contributions secondaires restent séparées. Aucun scoring disciplinaire, calcul financier, commission ou décision automatisée n’est produit.

Le rollback applicatif consiste à retirer le contrôleur, le service et la page consolidés. Les rapports unitaires restent indépendants ; aucune migration ni donnée persistante n’est concernée.

## Intégration interactive

Les filtres `period`, `from`, `to`, `campus`, `campaign`, `program`, `source`, `channel`, `adviserId`, `status` et `view` sont portés par l’URL. L’API refuse les clés inconnues, les valeurs mal formées, un campus hors périmètre et toute tentative d’un Conseiller de consulter une vue globale ou l’identité d’un autre conseiller. Les périodes prédéfinies sont calculées côté serveur ; la période personnalisée exige deux bornes valides. Le fuseau métier reste `Africa/Casablanca`.

Les graphiques utilisent des éléments HTML locaux, sans télémétrie ni service tiers. Chaque visualisation est focalisable au clavier, possède un libellé complet pour lecteur d’écran et un tableau alternatif. La couleur n’est jamais le seul porteur d’information.

Les liens de drill-down traduisent les filtres reporting vers les filtres de la liste Leads et ajoutent un `returnTo` strictement limité au dashboard. La liste applique le périmètre campus côté serveur, ainsi que les filtres canal, responsable et collaborateur.

L’export `manager-dashboard-export-v1` reprend le même rapport et les mêmes filtres. Il ne contient que des agrégats, indique le fuseau et la période, utilise un nom déterministe et neutralise les cellules commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot.

Les préférences locales sont limitées à l’affichage compact, la visibilité des tableaux alternatifs, une période préférée et un seuil de présentation borné entre 1 et 100, dans la clé `crm-reporting-preferences-v1`. Elles ne modifient aucune formule KPI. Aucun identifiant de lead, PII ou secret n’est conservé.

Le scénario Playwright `apps/web/e2e/reporting.spec.ts` utilise des réponses intégralement synthétiques et vérifie filtres, rafraîchissement, cartes, graphiques accessibles, drill-down, retour, export, vue personnelle, refus anti-IDOR et états vide/erreur. Il s’exécute avec `npm run test:e2e:browser`.
