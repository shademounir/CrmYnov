# CRMY-162 — socle de données du dashboard, recette partielle

Exécutant : Codex, délégation `crm-ynov-po-delegation-20261001`.
Préparation indépendante de CRMY-161 ; la dépendance n'est pas supprimée.
Ce document ne vaut ni décision de livraison finale, ni acceptation visuelle,
ni preuve de déploiement du dashboard sur DEV.

## Matrice des critères Jira relus le 5 octobre 2026

| Critère exact | Preuve acquise dans ce lot | Preuve restante |
| --- | --- | --- |
| KPI nouveaux leads, qualifiés, inscriptions et conversion issus de l'API. | Rapports backend existants, cohorte filtrée et autorisée ; données persistées relues ; calculs de conversion non redéfinis. | Recette connectée du build exact, vérification de la présentation des quatre indicateurs ; CI exacte. |
| Funnel, acquisition par source, actions à traiter et derniers leads accessibles. | Rapports persistants, équivalents textuels existants ; endpoint récent borné à la même cohorte, sans email ni téléphone. | Contrôle navigateur des accès et des panneaux ; appréciation visuelle séparée. |
| Filtres période, campus et périmètre conservés dans l'URL selon les droits. | URL/DOM ciblés : vue personnelle, canal, campus, conseiller, borne exclusive `createdBefore` ; instant `createdFrom` conservé jusqu'à édition explicite. Campus canonique et grants revalidés dans PostgreSQL. | Retour réel depuis une fiche individuelle non qualifié ; recette responsive. |
| KPI, drill-down et exports cohérents sans donnée statique dans le chemin normal. | Cohorte exacte Leads uniques/derniers Leads, imports par provenance autorisée, valeurs indisponibles `null` plutôt que faux zéro ; export agrégé existant préservé. | Files legacy non équivalentes aux KPI : les libellés les signalent ; la cohérence métier complète de ces parcours reste à apprécier. Le lien Inscrit change explicitement le statut si filtre contraire. |
| États chargement, vide et erreur ; équivalent textuel des graphiques. | Tests DOM ciblés et états indépendants des derniers Leads ; source indisponible signalée ; tableaux et textes existants préservés. | Capture navigateur et responsive sur build identifié ; pas d'audit visuel revendiqué derrière une session expirée. |
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

## Résultats locaux réellement obtenus

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

## Contrôles distants et limites de livraison

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

CRMY-161 est encore In Review : récupération complète à finaliser et release
requise à qualifier avant sa clôture. CRMY-162 reste techniquement préparée,
sans codex-ready, Ready, décision déléguée ou fusion tant que ces conditions et
ses propres preuves manquent. Aucun DEV, STAGING ou PROD déployé par ce lot ;
aucun appel, envoi de mail, migration DEV, import Sheets ou changement natif.

Retour arrière envisagé : revert protégé des adaptateurs/du Web compatibles,
reconstruction et promotion du digest exact ; aucun reset/restauration SQL,
effacement d'historique ou élargissement de droits. La recette visuelle et les
limites ReadCommitted/qualité d'ingestion demeurent distinctes.
