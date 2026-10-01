# Inventaire fonctionnel UI, API et persistance

Date de l’inventaire local : 16 septembre 2026.

Cet inventaire décrit les routes et contrats présents dans le worktree UI. Il ne transforme pas les 35 routes générées par le build en 35 écrans validés. Le rapprochement avec le backlog Jira courant reste à effectuer après authentification interactive en lecture seule.

| Story locale | Navigation et surfaces | Routes principales et secondaires | Contrat API | Persistance constatée | Preuve actuelle | Écart principal |
| --- | --- | --- | --- | --- | --- | --- |
| CRMY-161 | Connexion, premier accès, récupération | `/`, `/first-login`, `/access-recovery` | sessions, changement de secret, récupération | PostgreSQL pour identités et sessions locales | tests Auth/API existants ; hors QA visuelle du lot Lead | revue visuelle Ynov V2 à intégrer à la campagne globale |
| CRMY-162 | Vue d’ensemble et pilotage Manager | `/manager/reports/dashboard`, rapports personnels et export | manager-dashboard, personal-dashboard | agrégats issus des Leads et activités persistants lorsque le repository est actif | tests reporting et build | écrans non comparés à la référence Relation Ynov ; définitions KPI à compléter |
| CRMY-163 | Liste, recherche, files de travail, création, vues | `/leads`, `/leads/new`, `/leads/quick-entry` | Leads CRUD, correspondances, vues enregistrées, partage/révocation | Leads, activités, reçus et vues persistants ; quick-entry conserve un adaptateur distinct | pilote Création, tests Web et API existants | recette visuelle finale liste/création et vrais sélecteurs pour tous les filtres |
| CRMY-164 | Fiche Lead, actions intégrées et routes détaillées | `/leads/[id]`, `/timeline`, `/status`, `/closure`, `/collaborators`, `/follow-ups`, `/documents`, `/appointments`, `/calls`, `/tags`, `/references` | Lead, timeline, statut, affectation, réaffectation, collaboration, clôture, relance, documents, rendez-vous, appels, tags | cœur Lead, correction, qualification, affectation, collaboration, clôture, relances, rendez-vous et historique téléphonique local persistants ; documents utilisent encore un service mémoire | `design-qa.md` passé pour la référence antérieure ; preuves HTTP/PostgreSQL dédiées par parcours | renouveler la comparaison visuelle après le diff final ; persister le sous-domaine documentaire avant de présenter son historique comme durable |
| CRMY-165 | Travail quotidien | `/manager/reports/commercial-funnel`, `/appointments`, `/notifications`, `/calls/queue` | funnel, relances, rendez-vous, notifications, téléphonie | funnel, relances, rendez-vous et Téléphonie locale alimentés par PostgreSQL ; le lot Notifications reste livré et validé dans sa PR distincte | tests complets, cycle PostgreSQL Téléphonie et pilotes Relation Ynov | validation personnelle de la file d’appels et de l’historique à 1280/820/390 ; fournisseurs téléphoniques réels hors périmètre |
| CRMY-166 | Imports et dossier candidat | `/imports/profile`, `/mapping`, `/wizard`, `/reviews`, `/reports/[jobId]`, `/documents/dashboard`, `/leads/[id]/documents`, `/admin/scheduled-sheets` | profilage, mapping, dry-run, confirmation, revue, rapports, documents, Sheets planifié | Sheets CRMY-171 persistant ; tables documentaires existent mais service runtime encore mémoire ; plusieurs assistants d’import restent des moteurs locaux | preuves CRMY-171 distinctes et tests documents | versionner le catalogue documentaire et relier le service documents à Prisma |
| CRMY-167 | Collaboration et administration | `/chat`, `/broadcasts`, `/admin/users`, `/admin/roles`, `/admin/references`, `/admin/audit`, `/admin/assignment`, `/admin/telephony` | chat, broadcasts, utilisateurs, permissions, référentiels, audit, affectation, téléphonie | permissions/référentiels/audit/affectation et Téléphonie locale persistants ; chat et broadcasts conservent encore des stockages locaux | tests unitaires et PostgreSQL ciblés des briques persistantes | généralisation visuelle et preuve de durabilité de chaque surface ; configuration admin Téléphonie à traiter séparément |
| CRMY-168 | Reporting et qualité | `/manager/reports/commercial-performance`, `/source-effectiveness`, `/operational-risks`, `/shared-contributions`, `/commercial-funnel` | endpoints de reporting dédiés | données de base persistantes, certains historiques explicitement indisponibles lorsqu’ils n’existent pas | tests de contrat reporting | définitions de température/complétude, KPI associés et QA visuelle groupée |

## Lot 1 — état vérifié

- Fiche Lead et actions intégrées : implémentées selon Relation Ynov.
- Pages détaillées Affectation, Interaction, Statut, Relance et Clôture : harmonisées et inspectées aux largeurs 1280, 820 et 390 px.
- Conseillers éligibles : endpoint serveur borné, revalidation au campus et à la permission, état vide non contournable par saisie d’un identifiant technique.
- Preuve intermédiaire : tests Web 141/141, API 356 réussis et 14 intégrations conditionnelles ignorées ; cycles PostgreSQL dédiés réussis pour la qualification, la correction et la relance. Les comptes finaux seront renouvelés après le diff final.
- Validation esthétique PO : ouverte.

## Lot 2 — température réalisée, complétude encore soumise à arbitrage

Le contrat de température a été validé par le PO puis implémenté : migration additive, historique append-only, API, droit explicite attribué par défaut uniquement à l’Admin en `CAMPUS` et au Super Admin en `GLOBAL`, filtre de liste, qualification depuis la fiche et répartition dans le Pipeline. Les autres rôles restent inchangés. Les preuves PostgreSQL couvrent deux instances, rejeu, concurrence optimiste, refus intercampus, rollback, évolution versionnée des anciens catalogues et relecture après redémarrage.

La complétude documentaire reste distincte et non approuvée. Le runtime `CandidateDocumentService` utilise encore des `Map` pour checklists, documents et événements malgré la présence de tables Prisma. Aucun état ou pourcentage réel ne doit donc être revendiqué avant sélection persistante d’un catalogue versionné et raccordement du service runtime.

## CRMY-165 — Notifications validées dans leur périmètre

Le 16 septembre 2026, le PO a validé personnellement la page Notifications après une recette connectée. La preuve couvre la création dédupliquée d'une notification de relance échue pour un conseiller synthétique, son compteur non lu, la lecture individuelle, la persistance après actualisation et redémarrage API, l'audit unique et l'ouverture de la relance cible. Le responsive a été contrôlé à 1280, 820 et 390 px sans débordement horizontal.

Cette validation est limitée au centre de notifications internes et au producteur de relance échue. Elle ne valide ni les canaux externes, ni la téléphonie, ni tous les producteurs déclarés dans le contrat, ni l'ensemble de CRMY-165.

## Backlog Jira

La lecture Jira authentifiée a confirmé CRMY-164 (« Refonte de la fiche lead, timeline et affectations »), rattachée à l’epic CRMY-158 et bloquée par CRMY-163. Elle a également confirmé CRMY-43 (« Modifier les informations autorisées d’un lead »), rattachée à l’epic métier CRMY-5. Une recherche ciblée sur la qualification et la température commerciale n’a retourné aucun doublon. La story dédiée autorisée reste à créer sous CRMY-5, avec liens vers CRMY-164 et le socle Lead ; aucun lien existant n’a été supprimé ou modifié.
