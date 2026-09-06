# CRMY-171 Import Sheets planifié

## État de réalisation

Tranche A commencée depuis `7c06743729f9d3fd0dd95f4a35b37a87c4fc3c55`.
Configuration, mapping versionné, ordonnanceur, moteur transactionnel, API/OpenAPI et interface d'administration sont raccordés localement. Les consommateurs historiques d'affectation utilisent désormais le résolveur Prisma par campus en mode persistant. Les preuves HTTP utilisent deux API NestJS compilées et PostgreSQL éphémère, exclusivement synthétiques. Aucun connecteur réel n'est activé. La tranche verticale reste NON publiable : contrôle visuel responsive final et gates complets restent à clôturer.

## Ordre du lot

### Implémenté et testé

- Adaptateur de lecture à hôte Google fixe, sans transport réel par défaut ; validation structurelle et erreurs expurgées.
- Identité canonique, empreinte, revue contrôlée et politique de reprise bornée.
- Tables additives, acquisition concurrente, bail et refus d'un worker périmé.
- Entrée technique transactionnelle du moteur canonique : Lead, provenance et audit ; preuves de rollback et de refus campus.
- Snapshots de mapping et versions de configuration persistants ; empreinte stable après passage JSONB et réutilisation sur une autre instance.
- Ordonnanceur serveur sans navigateur et file manuelle persistante utilisant le même moteur ; reçus/progression dans la transaction métier.
- Réévaluation de l'utilisateur délégant actif et de ses capacités, sans création de session pour l'acteur SYSTEM.
- Parcours HTTP authentifié : configuration initialement désactivée, simulation sans Lead, activation, premier import autonome, rejeu manuel, historique, désactivation, refus intercampus et rôle non admissible.
- Déduplication intercanal FORMINATOR_ZAPIER, contenu divergent en revue sans écrasement du Lead et absence d'identifiant stable sans création.
- Tests Web DOM : configuration, activation, simulation, lancement, historique et retours exclusifs succès/erreur.

### Raccordements et preuves supplémentaires du 6 septembre

- `/assignment/auto` : arbitrage PO consigné dans Jira 12274. Décision persistante, curseur et audit atomiques, sans mutation du Lead ni événement d'affectation effective. Rejeu par `eventKey`, y compris après changement de version des règles ; réutilisation incompatible refusée. Deux API, concurrence, rollback d'audit et refus intercampus testés en HTTP/PostgreSQL.
- `/assignment/simulate` : preuve HTTP dédiée ; aucun changement du Lead, du curseur, de l'historique ou de l'audit métier. OpenAPI explicite ces effets.
- Historique : décisions Prisma réellement enregistrées et version d'origine conservées après changement de configuration, sans recalcul ni reconstruction de l'ancien historique mémoire.
- Simulation d'import manuel : même résolveur persistant, offsets de prévisualisation en mémoire propres à la simulation, aucun curseur consommé. Confirmation et réaffectation conservent leurs contrôles métier et leurs permissions distinctes.
- Charge et tableau de bord : règles Prisma et données limitées aux campus autorisés. Une régression détectée par le test intercampus a été corrigée dans la lecture du tableau de bord ; les compteurs de lots non persistés sont explicitement indisponibles (`null`), jamais reconstruits.
- Worker : erreurs externes avec trois tentatives bornées et échéances persistées ; révocation pendant la lecture ; références inconnues en revue ; interruption après deux lignes puis reprise sans doublon sur une seconde instance. Cinq scénarios PostgreSQL exécutés avec succès. Une correction mécanique de liaison de méthode dans le test doit encore être réexécutée dans ce cycle.
- Parcours Playwright 1.55.1 UI → API → PostgreSQL réellement exécuté : configuration désactivée, mapping, simulation sans Lead, activation, import autonome, rejeu manuel sans doublon, historique et désactivation. Données et sessions exclusivement synthétiques.

### Implémenté mais restant à valider — actualisé après relance autorisée

- Correction CSS limitée à l'écran Sheets (largeur du formulaire et couleur de lien), build Web réussi. Après arrêt par la session puis relance sur 3021, le CSS corrigé est effectivement servi. Contrôles de lecture et clavier à 1280, 820 et 390 px réussis, sans débordement ni erreur console. La fixture PostgreSQL initiale est conservée ; le parcours de création n'a pas été rejoué sur elle.
- Raccordements fonctionnels terminés ; réexécution des gates complets sur leur état final encore requise. Les mappings manuels restent en mémoire, limite distincte volontairement conservée.

### Restant à développer et prouver

- Achever les preuves UI desktop/tablette/mobile, accessibilité et parcours intégré.
- Gates complets, couverture canonique, scans des images affectées, Draft PR et audits du SHA final.

Cette séparation décrit l'état de reprise ; chaque élément ne sera marqué livré qu'après sa preuve effective.

### Origine historique de la remédiation : administration des règles d'affectation

Avant le raccordement, `AssignmentController.configure()` appelait une configuration en mémoire (`Map`) sans écriture Prisma. Les scopes GLOBAL/SOURCE/CAMPAIGN du modèle historique décrivent la sélection métier, pas un plafond RBAC. Le chemin persistant utilise désormais les services campus Prisma ; le moteur historique reste réservé aux parcours synthétiques sans base. Aucun pool arbitraire ou transfert automatique de règles mémoire n'a été ajouté.

Arbitrage PO reçu et consigné dans Jira CRMY-171, commentaire 12241 : stockage distinct par campus, priorité Campagne → Source → repli du campus, puis UNASSIGNED avec résultat explicite si aucune configuration. Une ambiguïté de même priorité, une règle invalide, une erreur technique ou un refus de permission ne déclenchent pas de repli. Trois tables additives conservent configuration courante, versions et curseurs ; aucune reprise des anciennes règles et aucune réaffectation des Leads. Contrôles dynamiques inchangés. Les tests ciblés couvrent deux campus, priorité, lecture par une nouvelle instance, concurrence et rollback configuration/audit ; le HTTP réel démontre qu'un worker applique la configuration persistée via l'administration.

Trace historique : la pause demandée le 5 septembre a été appliquée puis levée par le PO le 6 septembre. Ses instructions d'arrêt ne s'appliquent plus. La reprise autorise les raccordements restants, les preuves UI et les gates complets. La classification finale n'est pas encore calculée.

1. CRMY-171 : configuration Admin, ordonnanceur, import Sheets, historique et preuves PostgreSQL/UI. Story High, 13 points, parent CRMY-9. Aucun Sprint forcé.
2. CRMY-65 : réutiliser la story d'ingestion Zapier ; compléter sa préparation avec la configuration du connecteur, sa documentation et la déduplication intercanaux demandées par le PO.
3. CRMY-66 : réutiliser la supervision/reprise Zapier, sans recréer un doublon.

Recherche effectuée sur les 170 tickets, puis sur leurs descriptions contenant Sheets, classeur ou planifié. CRMY-64 reste la référence du contrat signé ; son endpoint actuel ne doit pas être présenté comme une ingestion persistante livrée.

## Référentiel et identité

Le CDC V1.4.2, sections 4.1–4.6, conserve PostgreSQL comme autorité après mise en service, le secours manuel et la priorité des identités externes. L'autorisation PO du 5 septembre 2026 ajoute Sheets planifié. La règle d'une seule alimentation automatique active reste applicable à la future production ; les tests intercanaux couvrent également les bascules et relectures tardives.

La clé de soumission utilise la source canonique `FORMINATOR_ZAPIER`, indépendamment du canal. Le numéro de ligne reste une information d'affichage, jamais une identité métier. Sans identifiant stable : revue contrôlée, aucune création ou fusion automatique. Même identifiant avec contenu divergent : revue, aucune modification silencieuse du Lead. L'empreinte est technique, non une preuve d'identité et non une anonymisation des données.

## Contraintes du raccordement réalisé

- Configuration et mapping versionné, exécutions et suivi des soumissions sont persistés avec contraintes uniques et migrations additives.
- Résoudre le campus depuis les références serveur ; vérifier rôle Admin/Super Admin et permission dynamique effective. Réévaluer les droits pour chaque exécution, sans fabriquer un principal privilégié.
- Utiliser un port de lecture synthétique fermé aux connexions réelles. Prévoir la future sélection du classeur/onglet sans accepter une URL arbitraire à appeler depuis le serveur.
- Claim multi-instance et reprise par bail borné ; transaction d'import et suivi idempotent, audit append-only dans la même transaction. Une désactivation empêche les nouveaux claims.
- Réutiliser la validation/mapping et la persistance canoniques. Le worker appelle le port transactionnel `persistSheetRecord` dans la transaction du coordinateur, et non une confirmation ouvrant une transaction indépendante. Les reçus, compteurs, soumissions et audit sont validés ensemble.
- Les mappings personnalisés manuels d'`ImportMappingService` restent en mémoire ; le chemin Sheets utilise son snapshot/version persistant, sans remplacer les identifiants ni conventions des mappings manuels existants.
- Administration Ynov V2 : configuration, simulation, déclenchement manuel, historique et compteurs ; contrôles API effectifs indépendants de l'affichage.

## Preuves historiques avant cette dernière remédiation

Les paragraphes de cette section décrivent des étapes antérieures, non l'état actuel des raccordements. Les chiffres et limites alors constatés ne remplacent pas les résultats actuels ci-dessous.

Preuves locales acquises avant la revue de raccordement : trois tests PostgreSQL du coordinateur/moteur/ordonnanceur verts, dont faute déterministe sur l'audit annulant Lead, soumission et progression ; un cycle HTTP complet avec deux API compilées vert ; quatre tests Web ciblés verts. Les snapshots et le moteur d'affectation partagé ont également passé leurs tests ciblés. Un passage complet API (353 tests : 343 réussis, 10 conditionnels ignorés) et Web (122 réussis avant ajout des quatre tests), lint, types et builds a réussi à un point intermédiaire. Ces résultats ne remplacent pas la relance sur le diff final. Les 34 migrations ont été appliquées sur la base HTTP éphémère propre. Aucune couverture finale, analyse Sonar, preuve Playwright CRMY-171 ou image nouvelle scannée n'est revendiquée.

Le port technique `persistSheetRecord` utilise un acteur explicite `SYSTEM:SHEETS:<connectorId>`, sans rôle administratif ni session personnelle. Il participe à la transaction clôturée par le coordinateur avec les compteurs, reçus et suivis de soumission. L'affectation UNASSIGNED est prouvée de bout en bout ; les autres stratégies ne sont pas validées tant que leur configuration persistante n'est pas administrable. Les cinq nouvelles migrations restent locales et non commises.

Avant commit/push : tests HTTP/Prisma de première importation, rejeu, collision intercanaux, références inconnues, rollback de l'audit, interruption/reprise, deux instances, désactivation, refus campus et 401/403/429/5xx ; puis gates complets du dépôt, images affectées et couverture. La classification effective ne peut pas être annoncée avant le diff final évalué par pr-policy. En manual-po, conserver Draft sans approbation ni Ready/fusion.

## Trace historique de la reprise du 6 septembre — état intermédiaire dépassé

Les demandes d'arbitrage et raccordements restants décrits ci-dessous ont ensuite été traités par l'arbitrage 12274 et les preuves de la section active. Ils sont conservés uniquement comme historique.

Complément de reprise : preuve HTTP dédiée `/assignment/simulate` verte (autre API, destinataire issu des règles serveur, Lead/cursors/audits inchangés). Historique Prisma par campus raccordé et testé : les décisions enregistrées restent identiques après une nouvelle version de configuration. OpenAPI décrit les entrées et la pagination. Type-check API vert et six tests ciblés dont le cycle HTTP PostgreSQL réellement exécuté verts.

Point de contrat à confirmer pour `/assignment/auto` : le code historique `AssignmentService.assign()` réserve une décision/avance le curseur et écrit un audit, sans modifier `Lead.assignedToId`. L'affectation effective appartient aux endpoints d'affectation confirmée. Ne pas transformer silencieusement ce raccordement en mutation directe du Lead. Le endpoint conserve donc son comportement actuel en attente de clarification décision seule versus affectation effective. Aucun commit/push/PR n'est réalisé dans cet état.

Les 49 empreintes du travail conservé et les dix fichiers du manifeste de sauvegarde ont été vérifiés avant les changements. Branche et HEAD conservés : `feature/CRMY-171-scheduled-sheet-import`, `7c06743729f9d3fd0dd95f4a35b37a87c4fc3c55`. Docker était déjà ouvert lors de la reprise ; seule la stack PostgreSQL sur volume et ses deux API/deux Web a été redémarrée. Les anciennes bases tmpfs restent arrêtées, sans restauration.

Raccordements supplémentaires réalisés et testés : résolveur extrait dans `assignment/campus-assignment-resolver.ts`, prévisualisation et affectation de lots via Prisma, rejeu sur une autre API sans dépendre du cache mémoire, confirmation d'import manuel utilisant le même résolveur dans la transaction. Les valeurs `resolvedAssignments` fournies par le client ne pilotent plus le destinataire. La permission effective `lead.assign` est réévaluée pour une affectation d'import manuel. Les rôles de l'acteur sont transmis à l'audit persistant.

Preuves du 6 septembre : type-check API et lint ciblé verts ; sept tests affectation/campus, neuf tests d'ingestion persistante et six tests mapping verts ; cycle HTTP PostgreSQL éphémère avec deux API compilées vert, incluant import autonome, rejeu, lot d'affectation et import manuel utilisant la configuration campus. La suite API non instrumentée est verte (356 tests, dont les tests PostgreSQL conditionnels non activés). Ces preuves ne valent pas validation de tous les harnais PostgreSQL ni couverture finale.

Encore incomplet : endpoint historique `/assignment/auto`, historique des décisions, simulation d'import manuel, réaffectation et indicateurs de charge utilisant encore les règles mémoire ; validation exhaustive des nouveaux raccordements (rollback, concurrence et refus campus), pagination/historique et parcours visuels CRMY-171, gates complets et scans des nouvelles images. La simulation `/assignment/simulate` a été raccordée mais doit encore recevoir sa preuve HTTP dédiée et l'alignement OpenAPI. Ne pas publier tant que ces éléments ne sont pas terminés. Les prévisualisations 3018/3019 sont encore CRMY-170, pas CRMY-171.

## Trace du premier blocage de prévisualisation — résolu lors de la reprise autorisée

- API : 357 tests, 345 réussis et 12 conditionnels ignorés ; Web : 126 réussis. Ne pas compter les conditionnels comme exécutés. Ces suites précèdent la dernière correction CSS et la liaison mécanique de méthode du harnais.
- Cycle HTTP/PostgreSQL à deux API : réussi ; cycle PostgreSQL dédié : cinq tests réussis avant cette liaison mécanique. Tests ciblés d'affectation et lint ciblé final réussis.
- Build Web après correction CSS : réussi. `next-env.d.ts` reste identique à `develop`. Aucun commit/push/PR ; HEAD conservé `7c06743729f9d3fd0dd95f4a35b37a87c4fc3c55`.
- `npm audit` : aucune vulnérabilité signalée dans cette exécution ; `security:scan` : cinq tests réussis ; `security:history` : réussi, zéro type de secret et zéro chemin interdit détectés. Ces scanners ne constituent pas une preuve absolue d'absence de toute donnée sensible.
- Lint complet bloqué avant ESLint par Prisma generate : `EPERM` lors du remplacement de `query_engine-windows.dll.node`, gardé ouvert par les API de prévisualisation CRMY-171. Aucun arrêt forcé effectué.
- Serveur CRMY-171 sur 3021 : parcours métier validé, mais ancien CSS encore servi après build. Le lancement d'un second serveur a été refusé par l'outil ; aucun contournement. Responsive final, E2E complets, Playwright officiel, couverture canonique, images/scans finaux et contrôles distants restent non validés.
- Prochaine action : obtenir un arrêt gracieux des seuls processus de prévisualisation CRMY-171 qui verrouillent Prisma, puis relancer la prévisualisation reconstruite par un moyen autorisé et reprendre les gates. Préserver la stack CRMY-170, les volumes, les images et les sauvegardes.

Preuves locales hors dépôt : `C:\Crm Ynov\output\crmy171-delivery-20260906`. La prévisualisation contient uniquement des fixtures synthétiques ; les fichiers de session et configuration privés de ce dossier ne doivent pas être publiés ou commis.

## Historique après levée du verrou — avant l'autorisation de remédiation du validateur

Les 63 empreintes ont été vérifiées identiques avant arrêt. Les trois processus ont été arrêtés par interruption de leur session identifiée, sans arrêt global Node. PostgreSQL tmpfs et CRMY-170 sont restés actifs. Prisma generate, lint complet, types et builds ont réussi avant relance. Les E2E ont révélé trois constructeurs partiellement annotés : les jetons Inject existants ont été explicités pour les autres paramètres de LeadAssignmentService, AssignmentDashboardService et OperationalRiskService, sans changer les règles métier. E2E relancés : 12 contrats de workflow et 9 scénarios API réussis sans DATABASE_URL. Lint ciblé, types/build API après ces corrections réussis.

- PostgreSQL CRMY-171 : cinq tests directs après correction du harnais et un cycle HTTP à deux API compilées réussis. Régression CRMY-169 : 20 tests réussis. Régression HTTP/PostgreSQL CRMY-170 : réussie avec fenêtre réelle 429, contrôle des deux ordres lecture/révocation, idempotence, campus et rollback.
- Playwright officiel : 13 réussis, un scénario local persistant conditionnel ignoré, non revendiqué comme exécuté. Le parcours CRMY-171 réel distinct est documenté séparément. Le runner Next dev a régénéré next-env.d.ts ; la commande officielle next typegen l'a ramené exactement à develop, sans édition manuelle.
- Couverture canonique Linux Node 22.21.1 : commande complète terminée avec succès après préparation des moteurs Prisma puis déconnexion réseau. 80,40097 % des lignes globales, 79,00373 % des branches ; estimation sur les lignes/branches nouvelles 61,53846 %, inférieure à 80 %. Aucun seuil/exclusion changé. Les harnais PostgreSQL conditionnels ne sont pas activés par cette commande ; les rapports non instrumentés distincts ne sont pas ajoutés artificiellement au LCOV. Détail des lignes manquantes : coverage-final-canonical.json hors dépôt.
- Images API et Web `20260906-final01` reconstruites : scans natifs Trivy 0.70.0, base du 6 septembre, zéro High/Critical et zéro secret détecté. Ces images précèdent seulement l'ajout ultérieur des marqueurs/commentaires et documents de rollback des migrations ; elles ne constituent pas une preuve image du diff documentaire final. Leurs preuves sont conservées.
- Blocage de gouvernance : après ajout des marqueurs et des six rollback.md, trois migrations restent refusées par migration-policy.mjs. 160000 et 170000 : ON DELETE RESTRICT / ON UPDATE CASCADE dans des CREATE TABLE déclenchent migration_destructive_or_data_statement. 200000 : DEFAULT 0 suivi de CHECK déclenche migration_sql_ambiguous. Aucun SQL exécutable, contrainte ou validateur modifié pour passer le contrôle. Une correction ciblée et testée du parseur requiert un arbitrage sur ce garde-fou ; aucune publication avec gate rouge.
- Restant après arbitrage : couverture nouvelle à compléter par tests effectivement exécutés/instrumentés, revalidation des migrations documentées, images finales, contrôles locaux restants, classification du diff et contrôles distants. Pas de commit/push/PR ni d'audit inventé sur un nouveau SHA.

## État actif — remédiation autorisée et validations du 6 septembre

Le PO a autorisé la reconnaissance structurée des FK de nouvelles tables (ON DELETE RESTRICT / ON UPDATE CASCADE) et de DEFAULT suivi d'un CHECK borné dans ADD COLUMN. Le parseur distingue les tokens SQL, les identifiants et les chaînes ; il ne retire pas globalement DELETE/UPDATE. Les instructions destructives, actions référentielles non reconnues et formes ambiguës restent refusées. Aucune exception par nom, modification des seuils ou suppression de contrainte.

- Six SQL exacts acceptés, 29 classifications historiques conservées. Suite politique/contrat de couverture : 149 réussis, un PostgreSQL conditionnel distinct ; ce dernier a réellement réussi sur deux bases éphémères dédiées (vide et antérieure peuplée). Les collaborateurs et Leads existants sont inchangés ; RESTRICT/CASCADE et CHECK sont vérifiés. Aucune modification de la prévisualisation ou de sa table `_prisma_migrations`.
- La commande canonique `npm run test:coverage` lance toujours la suite complète puis cinq tests PostgreSQL directs et le cycle HTTP avec deux API compilées. Tous héritent de la même collecte V8. Un helper de test vide les compteurs natifs avant SIGTERM, sans être chargé en production. c8 effectue seul le remappage et le LCOV, avec les mêmes include/exclude et seuils. Le même runner est appelé par la CI ; les bases de test lui appartiennent, sont vides et identifiées par un marqueur synthétique avant migration.
- Mesure Linux finale locale : lignes globales 87,54864 %, branches 88,79189 %, nouveau code estimé 93,52179 % (ancienne mesure sans PostgreSQL instrumenté : 61,53846 %). Les fichiers non couverts restent visibles ; le rapport local ne remplace pas Sonar sur le futur SHA publié.
- Tests complémentaires : métadonnées mal formées, caractères de contrôle, versions, actions/champs de mapping interdits, identité canonique et stratégies ; liste de configurations depuis la seconde API. La relecture Jira a confirmé le critère de pagination : historique enregistré désormais consultable par pages de 50, tri date descendante puis identifiant. Preuves HTTP de 51 événements en deux pages, aucune mutation/historique recalculé et refus intercampus ; navigation précédente/suivante et actualisation à la page 1 testées dans le DOM.
- Lint, types et builds ont réussi ; E2E isolés : 12 contrats et 9 scénarios API. Playwright officiel : 13 réussis et un conditionnel ignoré, non revendiqué. Prisma valide/généré ; npm audit production zéro vulnérabilité ; secrets/historique et SBOM réussis. Trivy IaC : zéro High/Critical avec checks embarqués (les paramètres cloud absents ne sont pas inventés).
- Images finales `crmy171-api:20260906-final04` et `crmy171-web:20260906-final03` reconstruites avec la base Distroless déjà épinglée. Le cycle HTTP complet passe sur deux conteneurs API ; le conteneur Web sert page/CSS et relaie les requêtes authentifiées et le refus anonyme. Leurs scans natifs, sans `ignore-unfixed`, ont chacun zéro High/Critical/secret ; 20 constats inférieurs sont conservés. Les images précédentes ne sont ni supprimées ni utilisées comme preuve des nouvelles.

Les rapports natifs, données V8 et captures restent hors Git ou sous `coverage/` ignoré. Le diff final est classé manual-po, notamment en raison du changement de gouvernance du validateur. Publication Draft, checks distants et audits SHA-bound restent à terminer. Aucune approbation PO, Ready ni fusion par l'agent. CRMY-171 reste In Progress ; CRMY-65/66 non démarrés.

## Remédiation PR 92 — affectation configurable et audit unique

L'arbitrage PO distingue le connecteur actif de l'affectation automatique active. Le contrôle Admin `/admin/assignment` lit et modifie le drapeau persistant `automaticEnabled` par campus avec la version attendue, sans remplacer les règles/destinataires. Le worker relit le même snapshot Prisma, y compris pour une stratégie FIXED planifiée. Une désactivation laisse l'import créer un Lead non affecté avec le résultat explicite `assignment_automation_disabled` ; l'affectation manuelle autorisée reste possible. Aucun rôle administratif n'est fabriqué pour SYSTEM.

Une affectation effective émet désormais un seul `LEAD_ASSIGNED`, enrichi à l'insertion (origine, référence de décision, version/règle). Aucune seconde émission `LEAD_AUTO_ASSIGNED` et aucune réécriture historique. Les événements d'import sans affectation conservent leurs métadonnées antérieures. `/assignment/auto` ne modifie toujours pas le Lead : décision, curseur et audit de décision atomiques ; les imports serveur autorisés n'exigent pas une confirmation humaine pour chaque ligne.

Preuves locales après correction : cycle HTTP réel sur deux API, quatre combinaisons toggle activé/désactivé et stratégie automatique/FIXED ; affectation manuelle avec toggle désactivé, faute d'audit avec rollback, rejeu sur l'autre instance sans doublon. CRMY-54 conserve les sept mutations/sept audits, acteurs et assertions métier ; seule sa fixture de configuration obsolète et le destinataire synthétique éligible ont été corrigés. Suite API avec CI=true : 375 réussis, cinq conditionnels ignorés ; Web : 128 réussis ; E2E isolés : 12 contrats et neuf scénarios API ; Playwright : 13 réussis, un conditionnel ignoré. Lint/types/builds verts.

Couverture canonique Linux, incluant PostgreSQL et deux API instrumentées : 87,56712 % lignes globales, 88,80309 % branches ; estimation sur le diff complet contre develop 93,32964 %. La mesure précédente 93,52179 % reste historique. Aucun fichier non couvert retiré, aucun seuil/exclusion changé ; confirmation Sonar requise sur le nouveau SHA. Les avertissements d'hydratation observés sur le dashboard Reporting dans la suite Playwright restent distincts du parcours Admin concerné.

Images de cette remédiation réellement testées via HTTP/PostgreSQL : API `sha256:42815e82d266e8466dc967f990c503844ef9cb20e29f3e560e88618a99408198`, Web `sha256:6d13de5a1a3c772f1b1a0f2d5a42e31b7952f799b6b0a224de05abf5d5212ce4`. Chacune : zéro High/Critical/secret détecté, 20 constats inférieurs conservés dans les JSON Trivy natifs. Base Trivy figée du 6 septembre, 07:00 UTC. Les preuves des anciennes images restent conservées et ne valident pas ces reconstructions.

La PR 92 reste Draft/manual-po ; les cinq échecs du head 846a1a9 étaient trois suites arrêtées sur la fixture CRMY-54, une analyse Sonar non exécutée après échec de son prérequis de couverture, et l'agrégat rouge. Les résultats distants du nouveau head doivent tous être relus avant revue PO. Aucun label d'approbation, Ready ou fusion automatique.

## Désactivation et rollback

Le chemin serveur est branché, mais toute configuration est désactivée initialement et le fournisseur refuse les classeurs non synthétiques. Passer `enabled=false` annule le run actif et invalide son bail : une ligne déjà validée reste conservée, un worker périmé ne peut plus valider une nouvelle ligne. Conserver configurations, suivis, provenance, audits, images et volumes. Un rollback applicatif doit refuser de lancer le connecteur s'il ne comprend plus sa version de configuration ; ne pas supprimer les tables ou restaurer silencieusement des données.

## Future mise en service réelle

Autorisation PO distincte, source/classeur/onglet approuvés, mapping et identifiant de soumission stables, accès lecture seule au minimum nécessaire, secret serveur hors Git/frontend/logs, politique de rotation et périmètre campus validés. Réaliser une simulation et une réconciliation avant activation d'un seul canal automatique. Aucun de ces prérequis ne nécessite un credential réel pour les tests synthétiques actuels.
