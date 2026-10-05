# CRMY-162 — socle de données du dashboard, recette partielle

Exécutant : Codex, délégation `crm-ynov-po-delegation-20261001`.
Préparation indépendante de CRMY-161 ; la dépendance n'est pas supprimée.
Ce document ne vaut ni décision de livraison finale, ni acceptation visuelle,
ni preuve de déploiement du dashboard sur DEV.

## Point courant après intégration explicite — 5 octobre 2026

Branche : `feature/CRMY-162-dashboard-connected-20261005`.
Le commit de merge `8c44d30ef931125c4c058a49afa499344099f72d` intègre
`origin/develop` à la source `e154b4318e01005830cee81b3619e78cfcabd33f`.
Ses parents sont l'ancien HEAD Dashboard
`ea0809f450c9a4152c940fc919e396b768734841` et cette source develop.
La branche de sauvegarde `backup/CRMY-162-before-auth-merge-20261005-1225`
conserve l'ancien HEAD ; les checkpoints et preuves antérieurs sont préservés.

Les deux conflits, dans `.github/workflows/application-quality.yml` et
`scripts/ci/coverage-runner.mjs`, ont été archivés intégralement dans le dossier
privé `output/crmy162-dashboard-proof-20261005/auth-merge-conflicts-20261005-1225`.
La résolution conserve les deux preuves PostgreSQL : reporting et récupération
d'accès. Les sources d'authentification, de récupération et d'invitation restent
identiques à la source develop intégrée ; elles ne sont pas réimplémentées dans
ce lot Dashboard. Ce merge local n'est pas la fusion de PR116.

Les correctifs suivants sont locaux et gelés pour examen, au-dessus de ce merge :

- Le KPI « Qualifiés » utilise réellement le statut courant `QUALIFIED` de la
  cohorte autorisée. La conversion utilise le ratio `enrolled` déjà calculé par
  le funnel ; une valeur absente ou `null` reste indisponible, jamais un faux zéro.
- Au changement de filtre, l'ancien rapport et ses capacités sont retirés.
  Un refus 403 ou une erreur ne laisse pas visibles des indicateurs ou actions
  issus du périmètre précédent.
- Les filtres canoniques retournés par le backend sont la source des liens.
  Les instants ISO de période sont conservés jusqu'à une édition explicite ;
  la borne UTC `[from, to)` est indiquée, sans la confondre avec l'affichage
  Africa/Casablanca. Les liens du pipeline conservent aussi `channel`,
  `adviserId` et `status`, ainsi que la borne supérieure exclusive.
- Le CSV agrégé reçoit deux lignes additives :
  `kpi,qualifiedCurrentStatus,,<nombre>` avec le nombre dans la colonne `count`,
  et `rate,enrolledConversionRatio,<ratio>,` avec le ratio dans la colonne
  `value`. Une conversion
  indisponible est exportée comme `UNAVAILABLE`, pas comme `0`.

Preuves ciblées de ces correctifs : 50 tests Web PASS, puis 2 tests DOM finaux
PASS ; lint des six fichiers Web concernés et typage Web sans émission PASS.
Les 7 tests API ciblés de l'export PASS. Ces résultats concernent les fichiers
locaux au-dessus de `8c44d30` ; ils ne sont pas des gates distants d'un nouveau
SHA publié. Aucune nouvelle recette connectée, capture aux cinq largeurs,
campagne PostgreSQL ou acceptation visuelle n'a été exécutée pour ce point.

PR121 a été fusionnée de façon protégée le 5 octobre 2026 à 12:40:57 UTC,
sur main `467848dc38f479d969b18de1295be2f2e18cd167`. Ses 16 gates main ont
ensuite réussi, puis la prérelease interne `v0.1.0-rc.2` a été publiée et le
workflow de publication `37313001866` a réussi. CRMY-161 est désormais Done
par la transition officielle « Clôturer après release », relue à 13:12:06 UTC.
Le lien de dépendance reste conservé, sans blocage artificiellement supprimé.
PR116 demeure Draft : ni Ready, ni `codex-ready`, ni décision de livraison ou
Jira Done ne sont déduits des seuls correctifs locaux. Les six critères restent
à qualifier sur le build publié et raccordé, sans acceptation esthétique globale.

## Correctifs nécessaires après les contrôles de `c073d275`

Sur `c073d275257f31b4867910848112e2515fdcfcb1`, Sonar a réellement refusé
la duplication nouvelle de 5,2 % au-dessus du seuil inchangé de 3 %.
Couverture nouvelle 95,7 %, notes A/A/A et hotspots revus 100 % passent.
La duplication provient des deux runners de preuve PostgreSQL, pas du Web.
Le helper `postgres-proof-runtime.mjs` mutualise uniquement leurs mécanismes
de compilation, empreintes, manifeste et garde Docker ; les DI, marqueurs,
bases, délais, contrôles spécifiques et arrêts des seuls conteneurs possédés
restent distincts. Les 19 tests unitaires ciblés et contrôles de syntaxe passent.
Ils utilisent des adaptateurs mémoire : ils ne sont pas une exécution réelle
des deux preuves PostgreSQL. Le lint direct de ces scripts est refusé au
chargement par la configuration typée existante ; il n'est pas présenté réussi
et aucune règle, exclusion ou limite Sonar n'est modifiée.

Le prochain SHA requiert ses contrôles distants, sa propre mesure Sonar et les
deux preuves PostgreSQL du workflow. Le refus de politique `jira_codex_ready_missing`
sur `c073d275` reste historique ; la recette connectée et la préparation Jira
ne sont pas déduites des tests locaux. Aucun déploiement DEV par ce correctif.

## Matrice des critères Jira relus le 5 octobre 2026

| Critère exact | Preuve acquise dans ce lot | Preuve restante |
| --- | --- | --- |
| KPI nouveaux leads, qualifiés, inscriptions et conversion issus de l'API. | Rapports backend existants, cohorte filtrée et autorisée ; données persistées relues. Correctif local : `QUALIFIED` courant réellement affiché et ratio `enrolled` existant, indisponibilité explicite ; aucune formule de conversion redéfinie. | Recette connectée du build exact, vérification de la présentation des quatre indicateurs ; CI exacte. |
| Funnel, acquisition par source, actions à traiter et derniers leads accessibles. | Rapports persistants, équivalents textuels existants ; endpoint récent borné à la même cohorte, sans email ni téléphone. | Contrôle navigateur des accès et des panneaux ; appréciation visuelle séparée. |
| Filtres période, campus et périmètre conservés dans l'URL selon les droits. | URL/DOM ciblés : vue personnelle, canal, campus, conseiller, borne exclusive `createdBefore` ; instants ISO conservés jusqu'à édition explicite et période UTC `[from, to)` signalée. Pipeline : `channel`, `adviserId` et `status` préservés. Campus canonique et grants revalidés dans la preuve PostgreSQL historique. | Retour réel depuis une fiche individuelle non qualifié ; recette responsive du nouveau build. |
| KPI, drill-down et exports cohérents sans donnée statique dans le chemin normal. | Cohorte exacte Leads uniques/derniers Leads, imports par provenance autorisée, valeurs indisponibles `null` plutôt que faux zéro ; CSV additif `qualifiedCurrentStatus` et `enrolledConversionRatio`, ce dernier `UNAVAILABLE` si non observé, vérifiés localement. | Files legacy non équivalentes aux KPI : les libellés les signalent ; la cohérence métier complète de ces parcours reste à apprécier. Le lien Inscrit change explicitement le statut si filtre contraire. |
| États chargement, vide et erreur ; équivalent textuel des graphiques. | Tests DOM ciblés et états indépendants des derniers Leads ; rapport et capacités périmés supprimés au changement de filtre et après refus/erreur. Source indisponible signalée ; tableaux et textes existants préservés. | Capture navigateur et responsive sur build identifié ; pas d'audit visuel revendiqué derrière une session expirée. |
| Fuseau Africa/Casablanca et calculs backend existants inchangés. | Regroupements via Intl/IANA, Node22.23.3/ICU78.3/tz2026c ; aucune conversion par décalage fixe, aucune formule du funnel redéfinie. | Confrontation à l'affichage navigateur réel du build. |

## Contrôle de données et d'autorisation

Le chemin persistant relit les Leads, relances, clôtures, réaffectations et règles
d'affectation. Il compose des lectures ReadCommitted sous la clôture d'autorisation
existante, avec session et grants actuels. Il ne revendique pas un instantané
atomique de toutes les tables. Les compteurs de rendez-vous et d'import respectent
les capacités actuelles ; une restriction donne `UNAVAILABLE` ou `AUTHORIZED_SUBSET`.
La qualité des occurrences d'ingestion n'est pas reconstruite durablement : elle
reste explicitement indisponible en PostgreSQL.

Les Leads récents utilisent la même cohorte (période, canal, source, campus,
conseiller propriétaire ou collaborateur actif, statut). Leurs données retournées
sont bornées ; aucun UUID n'est présenté comme nom de personne. Les liens de
liste conservent la borne supérieure exclusive, sans modifier l'ancienne borne
`createdTo` inclusive.

Les files `FOLLOW_UP`, `NO_ACTIVITY` et `UNASSIGNED` ont leurs définitions legacy
propres. Le KPI de relances compte des relances, pas des Leads. Le seuil de première
interaction structurée n'est pas `lastActivityAt`. Les statuts terminaux peuvent
figurer dans la file non affectée. Aucune équivalence de nombre de lignes n'est
affirmée et aucune formule n'est modifiée pour faire coïncider artificiellement les
résultats.

### Correction ciblée de cohérence au-dessus de `c073d275257f31b4867910848112e2515fdcfcb1`

Le signal « Première interaction échue » n'ouvre plus `NO_ACTIVITY` : son nombre
est un agrégat non cliquable, avec la mention « sans file équivalente ». La même
garde concerne l'alerte API `first_interaction_overdue` dans le tableau des priorités
et dans les alertes opérationnelles. Un lien distinct vers la file legacy des
Leads sans activité reste disponible, sans la présenter comme les N résultats du
signal. Les liens de relances précisent localement qu'ils ouvrent une file de Leads
distincte du compteur de relances ; les liens non affectés précisent que leur file
inclut aussi les statuts clos, contrairement au compteur de Leads actifs.

Le test ciblé a réellement échoué avant correction sur le signal cliquable, puis
sur le lien de l'alerte `first_interaction_overdue`. Après correction : 43 tests
Dashboard DOM/SSR PASS / 0 FAIL / 0 SKIP, lint des deux fichiers concernés PASS et
typage Web sans émission ni incremental PASS. La fixture contient l'alerte réelle,
et vérifie les trois rendus, les libellés locaux et la conservation de campus,
canal, conseiller et bornes ISO `[from, to)`. Aucun calcul API ni droit n'a changé.
Ces preuves portent sur les changements locaux au-dessus de `c073d275` ; elles ne
sont ni une recette connectée, ni des captures responsive, ni un nouveau gate
distant. Le SHA final publié et ses contrôles restent à rattacher.

## Résultats locaux historiques réellement obtenus

- 37 tests API ciblés PASS, typage API et lint ciblés PASS.
- 35 tests Dashboard Web (22 initiaux, 13 branches supplémentaires) et 15 tests
  Lead-read PASS ; lint ciblé et typage Web sans émission PASS.
  États natifs `output`, lectures annulées/obsolètes, préférences refusées par le
  navigateur et compteurs indisponibles sont qualifiés sans changer les calculs.
- PostgreSQL isolé : 5 PASS / 0 FAIL / 0 SKIP (quatre scénarios et leur parent),
  deux API réelles et 46 migrations appliquées sur une base tmpfs indépendante.
- Compilation TypeScript 5.9.2 réelle, CommonJS conforme au package API,
  métadonnées Nest qualifiées ; 348 sorties, 2 710 150 octets. Aucun provider de
  substitution, génération Prisma ou build Shared ajouté à cette preuve.
- Scénarios : période/canal/campus UUID→code et deux campus isolés ; écritures
  relances/clôture/métadonnées après initialisation visibles depuis l'autre API ;
  imports bornés par provenance et restrictions explicites ; OWN et révocation
  sur une session existante.
- TAP de la dernière exécution : SHA256
  `007f226a27dc4747bd122ad3f0e0a83a74614a49c20f33f55f3ac664875975a6`.
- Manifeste compilé : SHA256
  `76d3683168fd4f484221ce9682eb581f8f7a569e5fa0c1f7a2b95c90bb468bb7`.

Les premières qualifications rouges et le premier résultat PostgreSQL rouge sont
conservés en privé. Corrections limitées au harness/fixture : module CommonJS,
représentation du tmpfs Docker, date de création des relances antérieure à leur
échéance et attendu temporel regroupé selon les règles IANA effectives.
La [source IANA](https://data.iana.org/time-zones/tzdb/africa) documente le passage
de Casablanca à +00 le 20 septembre 2026 ; l'hypothèse implicite +01 en octobre
était périmée. Aucun changement de calcul métier pour obtenir le succès.

Le seul conteneur nonce de preuve a été arrêté et son état vérifié ; il est
conservé. Le tmpfs disparu n'est ni une sauvegarde ni une restauration testée.
Les conteneurs conservés d'autres chantiers sont intacts.

## Contrôles distants historiques et limites de livraison

Sur `b05182e8eca66bc830f8c3bc8bbf74d27fe2c377`, le workflow
[37264036844](https://github.com/shademounir/CrmYnov/actions/runs/37264036844)
a réussi lint, typage, unitaires, intégrations, Playwright, build, secrets,
dépendances, scans API/Web et CodeQL. Prisma, Terraform/IaC et simulate ont réussi.
Le runner reporting PostgreSQL distant a obtenu 5 PASS / 0 FAIL / 0 SKIP.

Sonar et l'agrégateur quality-gate ont réellement échoué : couverture nouvelle
79,2 % sous le seuil 80 %, fiabilité D liée au tri du runner sans comparateur.
Corrections ciblées et tests réels ajoutés, sans seuil/exclusion modifié.
Le runner isolé, déjà exécuté dans le job d'intégration, est aussi raccordé à la
commande canonique c8 : ses processus enfants héritent de `NODE_V8_COVERAGE`.
Le prochain SHA doit obtenir sa propre mesure distante ; aucun succès supposé.

Le premier refus de politique était `jira_audit_comment_missing`. Un audit
factuel a été publié après relecture Jira, sans prétendre que codex-ready ou la
dépendance CRMY-161 sont satisfaits. Aucun contrôle local ne vaut gate distant.

Le HEAD historique suivant `ea0809f450c9a4152c940fc919e396b768734841` a obtenu
ses gates techniques propres : application
[37265557321](https://github.com/shademounir/CrmYnov/actions/runs/37265557321)
et agrégateur `111623602681` SUCCESS ; Sonar Quality Gate OK, couverture
nouvelle 95,03 %, duplication 0 %, fiabilité/sécurité A et hotspots revus 100 %.
La politique
[37265557311](https://github.com/shademounir/CrmYnov/actions/runs/37265557311)
(`111621572248`) a refusé `jira_codex_ready_missing`.
Le reporting PostgreSQL distant a obtenu 5 PASS / 0 FAIL / 0 SKIP sur ce lot.
Le point privé `facts-gates-ea0809f-20261005-052300.json` conserve les résultats
et identifiants exacts. Ces preuves restent historiques : elles ne couvrent
automatiquement ni le merge `8c44d30`, ni ses correctifs locaux, ni le futur
HEAD à publier. Aucun ancien résultat Sonar n'est réattribué.

Au moment des contrôles historiques ci-dessus, CRMY-161 était encore In Review.
Elle est désormais Done après qualification de sa release, comme décrit au
point courant ; son lien de dépendance est conservé. CRMY-162 reste techniquement préparée,
sans codex-ready, Ready, décision déléguée ou fusion tant que ces conditions et
ses propres preuves manquent. Aucun DEV, STAGING ou PROD déployé par ce lot ;
aucun appel, envoi de mail, migration DEV, import Sheets ou changement natif.

Retour arrière envisagé : revert protégé des adaptateurs/du Web compatibles,
reconstruction et promotion du digest exact ; aucun reset/restauration SQL,
effacement d'historique ou élargissement de droits. La recette visuelle et les
limites ReadCommitted/qualité d'ingestion demeurent distinctes.
