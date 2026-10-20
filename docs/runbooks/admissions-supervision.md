# Supervision fonctionnelle Admissions et files communes

Le rôle technique `ADMISSIONS` continue de désigner un Commercial. Il ne suffit pas à ouvrir le Pipeline d'équipe. Une désignation `AdmissionsResponsibility` active, correspondant au compte actif et activé et à son campus canonique courant, constitue une source supplémentaire de **lecture** `reporting.pilotage.view`. Elle est relue dans la transaction de permissions de chaque requête ; aucune propriété de formulaire ou de jeton ne peut l'affirmer.

La désignation ne remplace pas `reporting.view` et `lead.view`, ni les plafonds globaux/campus. Un plafond de pilotage `NONE`, `OWN` ou `TEAM` ne permet pas cette source de supervision campus. Les restrictions de lecture des Leads continuent à filtrer chaque ligne. Elle ne donne ni export, annuaire administratif, modification des dossiers d'autrui, validation commerciale, auto-approbation, ni accès à un autre campus. Les droits ordinaires Manager/Admin/Super Admin et leurs restrictions restent inchangés.

Le menu utilise la capacité serveur actuelle et distingue « Responsable Admissions · supervision » du rôle Commercial. La révocation de la désignation retire la supervision à la prochaine requête, y compris dans une session déjà ouverte sur une autre instance. La vue explicitement personnelle reste personnelle.

Les sept files `commercial-work-v2` sont calculées côté API puis paginées à partir de la même sélection. Pipeline et dashboard transmettent les mêmes filtres de cohorte : campus, campagne, source/canal, conseiller impliqué, dates de création et dernier traitement. Les sous-tableaux par conseiller sont explicitement des portefeuilles principaux actuels ; leurs liens fixent `adviserScope=PRIMARY`.

Compatibilité de déploiement : l'API conserve les six files `commercial-work-v1` par défaut pour les navigateurs déjà ouverts. La nouvelle interface demande explicitement `contractVersion=2` ; tous les liens v2 conservent cette version. Les versions inconnues et `NEW_RECEIVED` avec v1 sont refusés, sans inventer une sélection de remplacement. Le plan API/Web doit garantir l'API prête avant le nouveau Web ; le graphe Terraform référence l'URI de la ressource API depuis le service Web, mais cette dépendance doit encore être vérifiée sur le plan effectif.

- Nouveaux reçus : acquisitions `NEW`, hors `BASELINE`, triées par ajout CRM décroissant. Les dates de réception source reconnue et de première observation CRM restent distinctes.
- Premier traitement en retard : Leads distincts strictement au-delà de 24 heures / Leads distincts À contacter. Une histoire connue non datée n'est pas une absence de traitement.
- Relances en retard : actions actives strictement échues / toutes les actions actives de la cohorte. Un Lead peut porter plusieurs actions ; ce taux n'est donc pas un taux de Leads.
- Dénominateur nul : taux non calculable, jamais un faux 0 %. L'égalité à l'échéance n'est pas encore un retard. Réalisées, annulées et échéances invalides sont séparées.

Les files se recouvrent et ne s'additionnent pas en un total unique. Chaque lecture API a son instant de génération ; le dashboard et le Pipeline ne prétendent pas constituer un instantané atomique entre requêtes.

## Date d’ajout au CRM

`createdAt` existe déjà dans le schéma : attribuée par le serveur et persistée, elle n'est pas modifiée lors des mises à jour, réaffectations ou rejeux. Les entrées client `createdAt` et `acquisitionKind` sont refusées. Aucun backfill, migration ni réimport n'est nécessaire.

Le libellé « Ajouté le » restitue date et heure de Casablanca dans les listes, fiches, cartes Pipeline/supervision et derniers dossiers du dashboard. Les acquisitions `NEW` sont identifiées ; `BASELINE` est une reprise historique, pas une nouvelle demande. La vue `NEW_RECEIVED` exclut `BASELINE` et impose l'ajout décroissant côté serveur. `MINE` conserve le choix de tri et accepte le filtre `acquisitionKind`, intersecté avec tous les autres filtres et droits.

Les raccourcis Aujourd’hui, 7 derniers jours et 30 derniers jours couvrent des journées civiles de Casablanca, aujourd’hui inclus ; la plage personnalisée inclut ses deux journées. Le runtime IANA convertit chaque minuit, sans supposer UTC+1. Les instants sont figés dans l'URL : début inclus, fin exclue (`from/to` pour les rapports, `createdFrom/createdBefore` pour la liste). Campus, campagne, source, conseiller, statut et traitement sont conservés. Modifier une période de Pipeline/dashboard recharge toute la cohorte et ses taux, pas seulement une carte locale.

Les bornes des liens existants restent exactes tant qu'elles ne sont pas modifiées. Les dates d'ajout, réception/observation et dernier traitement sont distinctes. Le retard strictement supérieur à 24 h conserve sa référence `receivedAt`. La file des relances reste ordonnée par échéance la plus ancienne ; les files urgentes précèdent les nouvelles acquisitions dans les cartes opérationnelles. La page Nouveaux Leads donne aussi accès aux retards sans restriction de période d'ajout.

## Réaffectation manuelle sans routage automatique — règles

Une configuration d'acquisition absente (version 0) ne bloque plus le choix manuel : la projection bornée renvoie uniquement les commerciaux actifs, activés, du campus canonique et possédant les capacités effectives de lecture/modification/relance nécessaires à leur propre portefeuille. Le propriétaire courant est exclu. Seuls identifiant, nom professionnel, charge et plafond sont renvoyés ; sans configuration, le plafond est explicitement `null`.

Une configuration déjà enregistrée demeure restrictive : un pool applicable conserve exclusions, suspension et capacité ; aucune règle applicable dans une configuration existante n'entraîne aucun repli vers un annuaire plus large. Plus de 500 candidats provoquent une erreur explicite, pas une liste partielle ou vide.

Le serveur revérifie la même éligibilité lors de la demande puis sous verrou lors de la décision. La décision distincte Manager/Admin, l'idempotence, le propriétaire/version attendus, les audits et transactions restent gouvernés. Aucun historique n'est réaffecté automatiquement. Cette lecture n'active ni routage automatique, ni Sheets, ni envoi externe.

Rollback : conserver toutes les écritures et désignations légitimes ; ne pas restaurer SQL. Un retour applicatif retire la nouvelle lecture fonctionnelle mais ne doit pas effacer les historiques ou décisions. Le job RC36 et son Scheduler sont des composants indépendants à préserver dans tout plan API/Web.
