# Lot Lead « Relation Ynov » — dossier de livraison

Date de consolidation locale : 11 septembre 2026.

## Séparation des livraisons

### PR92 — CRMY-171 publiée

- Branche : `feature/CRMY-171-scheduled-sheet-import`.
- Head local et distant : `87242fd69f5c2ffb8d35f140338b37fd8ac20d52`.
- État du dépôt principal : propre.
- PR : Draft, gouvernance `manual-po`, aucune approbation, aucun passage Ready et aucune fusion réalisés par Codex.
- Périmètre : configuration et exécution Sheets, Google réel strictement en lecture seule, identité `LOCAL_ROW`, rejeu, progression, audit et affectation atomiques.
- Hors PR92 : Relation Ynov, qualification commerciale, nouveaux defaults de droit Admin/Super Admin, correction détaillée du Lead et relances persistantes.

Les 24 contrôles techniques distants, la couverture Sonar du nouveau code à 94,6788 %, la fiabilité A et l'absence de nouveau bug portent uniquement sur ce head. Le seul refus distant est `po_approved_label_missing`, attendu avant la décision personnelle du PO.

### Worktree UI — lot distinct à publier

- Worktree : `C:\Crm Ynov\worktrees\crmy-ui-pilots-20260906`.
- Branche dédiée : `feature/CRMY-172-lead-workspace`.
- Head de base : `71c6750d35b762e933a31682d360368c147bb010`.
- Les sources modifiées et non suivies sont conservées localement. Elles ne sont couvertes ni par le SHA de PR92 ni par son Sonar.

Le lot contient :

- fiche Lead Relation Ynov, actions principales en panneaux latéraux et pages directes partageant les mêmes formulaires et contrats ;
- correction des informations d'un Lead avec validation des référentiels, normalisation bornée, conflit de contact sans fusion, version optimiste, idempotence et audit atomique ;
- température humaine `UNEVALUATED`, `COLD`, `WARM`, `HOT`, historique append-only, filtre liste et KPI de répartition ;
- permission `lead.qualification.update`, Admin `CAMPUS`, Super Admin `GLOBAL`, autres rôles inchangés, évolution versionnée/auditée des anciens catalogues ;
- relances persistantes avec création, report, clôture ou annulation, transaction, rejeu exact, concurrence multi-instance, refus intercampus, rollback et relecture après redémarrage ;
- administration des permissions avec libellés métier, sans exposer les noms internes aux utilisateurs.

## Validations locales du diff courant

- Suite canonique avant le dernier ajustement responsive : racine 415 réussis et 1 ignoré, API 356 réussis et 14 ignorés, Web 143/143, shared 1/1 ; aucun échec.
- Après correction du débordement desktop et de l'ordre mobile, la suite Web dédiée compte 145/145 tests réussis et le build Web de production `xwfhtQ9qSpJkEPAVR2X8G` expose 35 routes sans erreur.
- Couverture locale du dernier passage complet : 29,41 % des lignes et instructions, 73,88 % des fonctions et 76,03 % des branches. Cette mesure globale locale ne doit pas être assimilée à la couverture Sonar du nouveau code.
- Qualification HTTP/PostgreSQL : 1/1, deux API, conflit optimiste, rejeu exact, refus intercampus, rollback et redémarrage.
- Relances HTTP/PostgreSQL : 1/1, transaction, rejeu exact, concurrence multi-instance, refus intercampus, rollback et redémarrage.
- Permissions dynamiques PostgreSQL : 22/22, dont migration du catalogue, defaults Admin/Super Admin, révocation inter-instance et bornes administratives.
- Lint complet, types complets et build API : réussis après arrêt des processus concurrents. Le build Web final a été renouvelé après les corrections responsive.
- Le dernier `git diff --check` est réussi. Les validations canoniques complètes seront néanmoins rejouées après l'intégration explicite de la branche PR92.

La couverture locale n'est pas une confirmation Sonar du futur SHA. Les contrôles distants et les audits SHA-bound devront être renouvelés après publication de ce lot.

## Revue visuelle et fonctionnelle

La référence approuvée reste « Relation Ynov ». Une recette connectée Admin a été menée sur une fixture dédiée, sans modifier les six Leads de référence : qualification `HOT`, correction d'identité et de coordonnées, passage `CONTACTED` vers `QUALIFIED`, ajout d'une interaction, création puis report et clôture d'une relance. Après actualisation, les valeurs relues correspondaient aux réponses serveur et l'historique append-only était présent.

La validation navigateur Super Admin n'est pas acquise : la base de recette ne contient pas de compte Super Admin persistant. Les tests HTTP/PostgreSQL couvrent ce rôle, mais ils ne remplacent pas une recette navigateur. L'affectation n'a pas pu être finalisée dans le navigateur car aucun autre conseiller autorisé n'était disponible dans la fixture ; le panneau et la page directe ont affiché cet état sans proposer d'action invalide.

Le build final local a été inspecté dans Chrome, avec la même fixture et la même session, à 1280, 820 et 390 px. À 1280 px, les six actions restent dans la largeur grâce à une grille 3 × 2 ; à 820 px, elles restent lisibles en grille 2 × 3 et le panneau de relance reste entièrement visible ; à 390 px, la situation commerciale et les actions précèdent le dossier, l'action principale et la relance occupent une ligne complète, et le panneau de relance est une feuille mobile sans débordement. Les contrôles ont porté sur le rendu réellement servi par `xwfhtQ9qSpJkEPAVR2X8G`, pas uniquement sur les tests.

Réserves visuelles : l'acceptation esthétique PO reste ouverte ; le champ natif `datetime-local` peut afficher un gabarit `mm/dd/yyyy` selon les réglages du navigateur, bien que la valeur persistée reste au format contractuel. Les captures observées dans la session navigateur n'ont pas été exportées comme artefacts locaux autonomes.

## Écarts explicitement conservés

- La complétude documentaire et ses quatre états ne sont pas approuvés.
- `CandidateDocumentService` conserve encore plusieurs états en mémoire malgré les tables Prisma ; aucun KPI documentaire durable n'est revendiqué.
- Rendez-vous, téléphonie, chat et diffusions possèdent encore des parcours mémoire à raccorder séparément.
- La notification d'échéance d'une relance reste un mécanisme d'exécution distinct ; la relance, sa décision, son audit et son reçu sont persistants.
- La preuve visuelle PO reste ouverte et ne peut pas être remplacée par les tests.

## Synchronisation future avec `develop`

Ne jamais réinitialiser, stasher ou écraser ce worktree pour récupérer PR92. Publier d'abord le lot sur sa branche dédiée et conserver un manifeste SHA-256 des fichiers. Après la fusion personnelle de PR92 par le PO, récupérer `origin/develop`, vérifier les manifestes avant/après, puis intégrer `develop` par un merge explicite dans la branche du lot. Résoudre les conflits migration par migration et fichier par fichier, puis rejouer l'ensemble des validations et audits sur le nouveau SHA.

## Raccordement Jira réalisé

- `CRMY-172` porte la qualification commerciale manuelle sous l'epic métier `CRMY-5` (« E04 — Leads cœur et dossier candidat »).
- La recherche Jira authentifiée n'a trouvé aucun doublon avant création.
- `CRMY-172` est reliée à `CRMY-43` (socle et correction du Lead) et `CRMY-164` (fiche et actions), sans suppression des dépendances existantes.
- La permission `lead.qualification.update` et son évolution versionnée sont tracées dans `CRMY-169`.
- La persistance et les transitions des relances sont tracées dans `CRMY-165`, avec distinction explicite entre enregistrement d'une relance et déclenchement ultérieur de sa notification.

## Empilement de la Draft PR

La branche de ce lot doit être proposée temporairement avec `feature/CRMY-171-scheduled-sheet-import` comme branche de base. Cette dépendance rend PR92 explicite et évite de présenter les commits CRMY-171 comme de nouveaux travaux du lot Lead. Après la fusion personnelle de PR92, `develop` sera intégré par merge explicite, sans reset ni écrasement, puis tous les contrôles et audits seront renouvelés sur le nouveau SHA.
