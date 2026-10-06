# CRMY-169 — permissions dynamiques, registre v1

Base : `4ee9123acf0b36bd9fa5c34a44d4b1cb1210d9da`.
Cette livraison de sécurité exige une revue manual-po. Elle ne vaut pas
autorisation de fusion, de déploiement ou d'activation cloud.

## Calcul et invariants

Pour chaque rôle : grant global du rôle ∩ plafond global ∩ plafond campus
∩ grant campus du rôle ∩ contexte serveur. L'union de ces résultats donne
le droit effectif, toujours borné par les validations métier du service appelé.
`NONE` ne contribue aucun grant : ce n'est jamais un deny sur les autres rôles.
Une configuration absente utilise le registre fermé ; une configuration
persistée invalide/illisible échoue sans fallback permissif.

Les contrôles de rôle réservés et les invariants existants restent des plafonds
supplémentaires : validation Manager, clôture, version optimiste, anti-IDOR,
ressource inactive, collaboration, dernier Super Admin et historique immuable.
Le catalogue ne crée aucune nouvelle action destructive. `lead.delete` est
absent. `users.edit` et `audit.export`, sans action actuelle correspondante,
sont visibles mais non attribuables (`NONE` seulement), pas annoncés livrés.
CRMY-54 reste au préflight, sans implémentation concomitante.

`OWN` : « Affecté ou collaborateur actif ». La collaboration est relue en base
et ne donne pas le droit de contourner une opération réservée au conseiller
principal ou à un Manager. `TEAM` dépend du conseiller principal actuel,
actif et dans le campus de la ressource. Une collaboration secondaire ne
change jamais cette équipe. Pour les rôles ordinaires, l'appartenance active
du collaborateur est utilisée ; pour MANAGER, une `TeamResponsibility` active
explicite est requise. Aucune responsabilité n'est inférée d'un ancien teamId.
Dans un cumul, chaque rôle est évalué séparément : l'absence de responsabilité
Manager ne retire pas un grant TEAM légitime provenant d'un autre rôle.

AUDITOR / Lecteur ne fournit aucune mutation, même sur un payload Super Admin.
AUDITOR + MANAGER peut toutefois recevoir une mutation de MANAGER. L'écran
explique les rôles sources, portées et plafonds ; les audits identifient les
rôles de l'acteur, la configuration, les avant/après, la version et le motif.

## Administration et persistance

Administration → Rôles et permissions (`/admin/roles`). Super Admin global ;
Admin seulement Manager, Conseiller et Lecteur de ses campus, hors ses propres
rôles et sans délégation supérieure à ses droits. Les autres rôles sont refusés
côté serveur. Les identifiants campus sont résolus par le serveur.

Quatre tables persistées : configuration courante versionnée, versions, grants
par version et audit append-only. Les versions et audits antérieurs sont conservés.
Une table technique d'epoch sérialise les unités d'autorisation, et une table
de responsabilité d'équipe représente la relation explicitement autorisée
par le Product Owner pendant cette réalisation. Trois migrations additives,
sans modification de données existantes ; tests sur PostgreSQL tmpfs neuf.

Les requêtes protégées utilisent une transaction Serializable et un verrou
consultatif PostgreSQL partagé par les API. Le verrou couvre relecture de
l'identité, résolution des permissions, traitement métier et commit. Les
transactions Prisma imbriquées participent à cette même unité. L'epoch empêche
l'utilisation d'un snapshot ancien ayant attendu une révocation.
Seule une acquisition en conflit *avant toute entrée dans le handler* est
réessayée (au plus quatre reprises). Aucun effet métier n'est rejoué
automatiquement. Les conflits de version métier restent des 409.

Les sessions sont recherchées par digest dans PostgreSQL à chaque requête :
une session créée sur API A fonctionne sur API B ; aucune dépendance à un
cache de démarrage. Le retrait d'un grant ne révoque pas la session. Une panne
de chargement produit un refus ; aucun token ni contenu sensible n'est loggé.

Les responsabilités d'équipe sont attribuées/révoquées explicitement par un
Super Admin possédant `users.roles.assign` et `roles.permissions.manage`, avec
confirmation et version attendue. La cible doit être un Manager actif du
campus et l'équipe doit avoir des membres actifs vérifiés en base. Révoquer
conserve la relation, incrémente sa version et ajoute un audit. Aucun backfill.

## API

Préfixe `/admin/role-permissions`, session obligatoire :

| Route | Méthode | Résultat |
| --- | --- | --- |
| catalogue | GET | Registre fermé, rôles, descriptions, compteurs |
| configuration | GET / POST | Lecture / nouvelle version atomique |
| preview | POST | Diff et utilisateurs concernés, aucun grant modifié |
| history | GET | Dernières 50 versions et audit |
| restore | POST | Ancienne configuration revalidée dans une nouvelle version |
| effective | GET | Explication des droits du demandeur dans le contexte serveur |
| team-responsibilities | GET / POST | Relations explicites, Super Admin uniquement |

OpenAPI est publié dans `/docs-json`. Payloads fermés, motif enum sans texte
libre sensible, confirmation explicite, versions optimistes. Aucune action
DROP/DELETE de configuration/version/historique n'est exposée.

## Tests et limites des preuves

- Tests purs : union, NONE, plafonds, contextes, AUDITOR, payloads fermés,
  inconnus, registry des routes et invariants de clôture/reporting global.
- Tests PostgreSQL : administration bornée, versions concurrentes (un gagnant),
  rollback commun grant/métier, histoire conservée, restauration revalidée,
  responsabilité TEAM retirée, deux vraies API et même session, lectures
  simultanées de l'éditeur sans conflit artificiel.
- Tests DOM React et Playwright : aperçu, annulation, sauvegarde confirmée,
  conflit, restauration, indisponibilité, noms accessibles, mobile/44 px.
- Les anciens tests HTTP de contrats métier *en mémoire* utilisent désormais
  un module de test explicite ; ils ne prouvent pas les garanties CRMY-169.
  Le module de production n'a aucun flag de contournement des permissions.
- En CI, le test PostgreSQL crée son propre conteneur localhost/tmpfs, déploie
  les migrations, puis supprime uniquement ce conteneur. Aucun volume existant
  ni base distante n'est utilisé. Les identités sont `example.invalid`.
- jsdom et ses types sont des dépendances de développement verrouillées :
  tests d'événements React et couverture Node, sans modification Sonar ni
  chargement de ressources externes. Playwright reste la preuve navigateur.

Le verrou global est volontairement conservateur : les requêtes protégées
sont sérialisées et un timeout est refusé. La liste de leads applique le filtre
serveur avant pagination mais parcourt les identifiants du périmètre ; cette
première implémentation ne prétend pas valider une charge de production.
Les limites métier existantes d'un service ne sont pas élargies par un toggle.
La mesure Sonar du head de PR et la revue PO restent indispensables.

Les identifiants secondaires chat, appel, rendez-vous et relance sont résolus
dans leur service propriétaire avant relecture et autorisation du lead dans
PostgreSQL. Une conversion chat exige aussi `interaction.create`. Les services
historiques en mémoire ne deviennent pas persistants dans cette story ; aucune
garantie de durabilité nouvelle n'est revendiquée pour eux. La liste des relances
est bornée aux leads visibles du campus avant restitution.

Les nouvelles clés étrangères TEAM utilisent `NO ACTION` non différable
(défaut SQL, explicitement déclaré dans Prisma). Les identifiants référencés
sont immuables ; aucune cascade ni modification de lignes existantes n'est
nécessaire. Le validateur CRMY-126 est conservé sans modification.

## Rollback

Une restauration fonctionnelle crée une version autorisée et auditée, sans
effacer l'historique. Révoquer une responsabilité par `active=false`, version
attendue et confirmation. Ne pas revenir automatiquement au fournisseur
statique : cela pourrait rétablir des droits révoqués. En incident, refuser les
accès concernés et corriger en avant, en conservant tables, versions et audits.
Ne pas supprimer de volume, ne pas utiliser de données réelles ni activer cloud.

Référence technique : [isolation PostgreSQL](https://www.postgresql.org/docs/current/transaction-iso.html).

## CRMY-178 — catalogue v4 : pilotage distinct de l'administration

`reporting.pilotage.view` contrôle le tableau de bord complet déjà développé et
ses rapports de pilotage. Il exige aussi `reporting.view` et `lead.view` dans le
même contexte de ressource. `OWN`, `TEAM`, `CAMPUS` et `GLOBAL` restent bornés par
les campus du compte, les plafonds et les relations actives relues côté serveur.
`reporting.view` et `reporting.export` acceptent désormais également `OWN` et
`TEAM`, sans changement automatique de leurs grants. L'export ajoute son propre
grant et filtre la même cohorte autorisée ; `reporting.global.view` reste réservé.

Une configuration absente conserve le pilotage Manager/Admin en `CAMPUS` et
Super Admin en `GLOBAL`. Commercial (`ADMISSIONS`) et Lecteur restent à `NONE`
pour le nouveau droit jusqu'à une délégation explicite. Une configuration
historique **complète** est convertie sans réécrire sa version : seuls les accès
déjà possibles avec l'ancien contrôle de rôle Manager/Admin/Super Admin sont
conservés, bornés par son ancien `reporting.view`; les plafonds reprennent leur
ancienne borne de reporting. Commercial et Lecteur ne reçoivent aucun grant
nouveau. L'adoption persistée ajoute une version et un audit `CATALOGUE_UPGRADE`.
Un `NONE` explicite v4 n'est jamais remplacé par l'adoption ou un redémarrage.
Une restauration volontaire, revalidée et confirmée peut changer les droits :
restaurer une version v3 rétablit sa borne historique de pilotage Manager/Admin;
restaurer une version v4 portant `NONE` conserve ce refus. Une version partielle,
inconnue ou invalide échoue sans fallback.

Le contexte autorisé est une preuve privée limitée à la lecture serveur sous le
verrou partagé. Aucun rôle, grant, propriétaire, responsabilité ni identité
fourni par le navigateur ne crée cette preuve. Elle est retirée à la sortie,
y compris sur erreur. Les révocations sont relues sur chaque requête. Un droit
de pilotage n'accorde ni administration des utilisateurs, des référentiels ou
des permissions, ni validation des réaffectations ou clôtures réservées.

`GET /reports/dashboard/capabilities` accepte uniquement le filtre facultatif
`campus` et rend seulement des booléens de navigation
effectifs, sans identité ni mutation : création de lead, reporting personnel,
pilotage, lecture des leads récents et export. La création est évaluée
indépendamment du reporting. Une panne refuse l'affichage des actions concernées;
le navigateur n'infère aucun droit de sa propre liste de rôles.

La table `AdmissionsResponsibility` représente une désignation pour l'agenda et
les réservations, pas une direction de centre ou une responsabilité d'équipe.
Elle n'accorde donc aucun pilotage campus implicite. Les KPI personnels et
l'agenda conservent leur contrat; un pilotage de centre nécessite une
configuration explicite autorisée. Aucun rôle fictif de directeur n'est créé.

### Preuves PostgreSQL CRMY-178

Le scénario `pilotage-http-postgres.test.ts` démarre deux API réellement
compilées par TypeScript (metadata de constructeur vérifiée). Il exige une base
neuve dédiée `crmy178_test_<UUID avec tirets>`, le marqueur indépendant
`crmy178_test_identity.marker` portant le même nonce et des tables publiques
métier/auth/configuration vides avant sa première écriture. Le test ne crée pas
sa propre preuve d'identité, ne vide aucune base et refuse les bases conservées
ou de preview. Les mots de passe synthétiques et de connexion restent privés.

Ce scénario local est ignoré par défaut : seule l'activation explicite
`CRMY178_EPHEMERAL_TEST=true`, avec `CRMY178_DATABASE_URL` et
`CRMY178_DATABASE_NONCE` dédiés, et l'adresse/port SQL du reçu indépendant dans
`CRMY178_DATABASE_SERVER_ADDRESS` / `CRMY178_DATABASE_SERVER_PORT`,
`DATABASE_URL` absent au lancement, connecteurs
Sheets désactivés et workers externes autorise son exécution. Il n'est pas
annoncé comme automatiquement exécuté en CI. Les gardes sont aussi testées sans
connexion PostgreSQL. Le runner CI reporting existant et sa garde CRMY-162 sont
inchangés ; ses cas pilotage synthétiques restent une preuve distincte.

Les assertions couvrent l'adoption v3/v4 append-only sur double démarrage,
restauration intentionnelle confirmée, révocation entre instances et sessions
déjà ouvertes, scopes OWN/collaboration et TEAM/responsabilité, séparation
personnel/pilotage pour une vue omise, Lecteur configuré, exclusion hors campus,
parité KPI, export séparé et refus des décisions/administrations non accordées.
