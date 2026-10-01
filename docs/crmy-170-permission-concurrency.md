# CRMY-170 — lectures concurrentes et révocation des permissions

Ce document décrit l'orchestration transactionnelle de la remédiation CRMY-170.
Les règles de `PermissionService`, GLOBAL/CAMPUS, OWN/TEAM, AUDITOR, propriété,
appartenance et anti-IDOR restent celles du contrat existant. Aucun nouveau
cache de permissions, changement de schéma ou dépendance n'est nécessaire.

La cible est PostgreSQL 17 avec Prisma Client 6.19.3. Le protocole s'applique
aux instances API qui partagent **la même base PostgreSQL locale**.

## Cause et séparation des unités

L'ancienne barrière prenait un verrou exclusif et exécutait un `upsert` avec
incrément de `RolePermissionEpoch` pour chaque unité protégée, y compris les
lectures. Les transactions Serializable qui attendaient ce verrou pouvaient
conserver un snapshot antérieur à l'incrément précédent. Leur accès à l'epoch
échouait alors avant l'exécution métier ; plusieurs lecteurs stables pouvaient
épuiser les tentatives et recevoir `permission_version_conflict`.

Le registre fermé `permission-transaction-routes.ts` sélectionne désormais le
mode d'après le **contrôleur et le handler serveur**, jamais d'après un paramètre
client ou la seule méthode HTTP. Un handler inconnu reçoit le mode `write` ;
le registre d'autorisation existant continue séparément de refuser les routes
qui n'ont pas de permission définie.

| Mode | Usage autorisé | Isolation de l'unité | Verrou PostgreSQL `(169, 1)` | Écriture de l'epoch |
| --- | --- | --- | --- | --- |
| `read` | Lecteurs purs inscrits au registre ; lectures directes de configuration et de vues partagées | `ReadCommitted` et `SET TRANSACTION READ ONLY` | `pg_advisory_xact_lock_shared` | Aucune, même si la ligne d'epoch n'existe pas encore |
| `read-audited` | Uniquement `AuditController.list` et `AuditController.detail` | `ReadCommitted` ; écriture de la preuve de consultation permise | `pg_advisory_xact_lock_shared` | Aucune |
| `write` | Mutations, révocations, lifecycles d'identité concernés, seed local et mode conservateur par défaut | `Serializable` | `pg_advisory_xact_lock` exclusif | Un `upsert` avec incrément avant l'autorisation ; annulé si la transaction échoue |

Le mode `read-audited` préserve uniquement les insertions append-only
`AUDIT_SEARCHED`/`AUDIT_VIEWED` déjà effectuées par le lecteur du journal. Ces
événements ne déterminent pas l'autorisation. Ce mode ne donne aucun droit de
modifier un rôle, une appartenance, une vue ou une permission.

Le niveau d'isolation global de Prisma et de l'application n'est pas modifié.
Les mutations conservent Serializable. Les transactions imbriquées utilisent
le client de la même unité via `PrismaService.withTransaction` : une lecture
dans une mutation conserve sa protection exclusive. Les promotions
`read` → `read-audited`, `read` → `write` et `read-audited` → `write` sont refusées
avant leur handler, sans acquisition supplémentaire ni interblocage d'upgrade.

## Déterminants protégés

Le verrou unique évite un ordre différent d'acquisition entre types de
ressources. Il est acquis avant de charger l'identité et les ressources de la
décision finale ; les verrous de lignes métier viennent ensuite.

| Déterminant persistant | Lectures qui l'utilisent | Chemins de modification coordonnés |
| --- | --- | --- |
| Configurations de rôles, plafonds globaux/campus, versions et grants | `snapshots`, `evaluatePermission`, décisions du provider dynamique | Sauvegarde et restauration de configuration dans `DynamicPermissionService` |
| Rôles, campus, équipe, activité et version d'authentification du collaborateur | `currentPrincipal`, résolution OWN/TEAM, audiences et propriétaire affichable | `UserController`, premier accès et point d'entrée du seed local |
| Session active, échéance et version d'identité associée | Middleware puis relecture de session sous barrière | Création de session, révocation individuelle, révocation utilisateur et mutations d'identité |
| Responsabilité explicite de Manager sur une équipe et son état actif | `resourceEvaluationContext`, audiences TEAM | `teamResponsibilities` avec entrée de mutation |
| Campus actif, code, libellé et clés canoniques | Résolveurs de campus et périmètres des ressources | Mutations de `ReferenceController` sous barrière exclusive |
| Campus du lead, affectation et collaborateurs actifs | Calcul OWN/TEAM et contrôle des ressources Lead | Mutations Lead, affectations, réaffectations et décisions de collaboration sous intercepteur |
| Propriétaire et état archivé d'une vue ; partage actif, audience et versions | Lecture/exécution des vues reçues, historique et capacités affichées | Partage, révocation, archivage et mutation des vues sous la même unité exclusive |
| État de premier accès, matériau d'authentification et challenge consommé | Lifecycles de connexion, changement initial et récupération | Refresh et écritures des adapters existants sous la barrière de lifecycle |

Une écriture SQL externe ou un futur traitement qui contournerait cette
barrière ne bénéficie pas du protocole. Tout nouveau chemin modifiant un de
ces déterminants doit participer au mode exclusif avant son premier accès
d'autorisation. Le harnais peut préparer ses fixtures avant les courses ; les
mutations concurrentes qu'il simule doivent respecter le protocole testé.

## Lifecycles et relecture de l'identité

L'authentification initiale du middleware ne remplace pas la décision finale.
Une identité issue de ce passage peut avoir été révoquée pendant l'attente du
verrou. `currentPrincipal` recharge donc le collaborateur et la session après
acquisition, puis l'intercepteur refait les contrôles de rôle et de ressource.

Les adapters locaux préexistaient. Leurs rafraîchissements remplacent désormais
les anciennes entrées par le résultat PostgreSQL courant, afin de ne pas
conserver une session révoquée ou une identité modifiée sur l'autre instance.
Cette relecture ne crée pas de cache d'autorisation et ne dérive aucun droit
nouveau des données en mémoire.

| Lifecycle | Orchestration sous verrou exclusif | Contrôle métier conservé |
| --- | --- | --- |
| `SessionController.create` | Recharge utilisateurs, credentials et sessions, puis exécute la connexion | Connexion publique, vérification du secret et rate limit existants ; pas de RbacGuard ajouté |
| `SessionController.revoke` / `revokeUser` | Réactualise le principal et le RbacGuard existant, puis recharge toutes les sessions actives avant sélection/comptage | Propriété de la session et rôle Super Admin inchangés ; fonctionne sans cache préalable de la session destinataire sur cette API |
| `UserController` | Recharge utilisateurs et sessions avant le handler | Restrictions de création, changement de rôle/campus/équipe, désactivation et dernier Super Admin inchangées |
| `FirstLoginController.change` | Réactualise le principal, les utilisateurs, credentials et sessions | Contrôle dédié au secret temporaire ; ne pas appliquer le RbacGuard générique qui refuse précisément cet état |
| `AccessRecoveryController.complete` | Recharge credentials et challenges encore valides avant consommation | Contrat public de récupération, challenge à usage unique et règles existantes inchangés |
| Point d'entrée `seed-local` | Transaction Serializable, même verrou exclusif et même barrière d'epoch avant les upserts | Identités synthétiques et idempotence existantes ; aucune restauration de données |

La création d'une session rejoint le verrou pour être ordonnée par rapport à
une révocation utilisateur simultanée. Le seed rejoint le protocole car son
rejeu peut réactiver ou réaffecter une identité existante. Les contrôles de santé,
la demande de challenge et le webhook Forminator synthétique non mutatif ne
sont pas assimilés à une décision de lecture de données CRM protégées.

## Point de linéarisation et garantie de révocation

En Read Committed, chaque nouvelle requête SQL lit un snapshot des données
commitées avant son début. Le SELECT d'identité exécuté **après** l'acquisition
du verrou partagé peut donc voir une révocation qui a commité pendant l'attente.
Le comportement des snapshots est décrit dans la documentation
[PostgreSQL 17 — isolation des transactions](https://www.postgresql.org/docs/17/transaction-iso.html).

La protection commence par l'acquisition du verrou, puis la relecture et la
décision finales. Le verrou reste détenu pendant le handler et jusqu'au commit
ou rollback de son unité. Une décision prise avant l'acquisition n'est pas
réutilisée. Pour les écrivains Serializable, l'incrément d'epoch avant le handler
fait échouer un snapshot périmé derrière un écrivain précédent, puis autorise
une reprise complète seulement avant toute exécution métier.

| Ordre constaté | Résultat attendu |
| --- | --- |
| La lecture obtient le verrou partagé avant la révocation | Elle est réautorisée et peut terminer ; la révocation attend sa fin transactionnelle avant de commiter |
| La révocation obtient le verrou exclusif avant la lecture | La lecture attend son commit, recharge l'état révoqué puis refuse ou masque la ressource selon le contrat canonique |
| Une nouvelle lecture commence après le commit de révocation | Elle tient compte de la révocation sur chaque instance API ; aucune ancienne décision n'est servie |

Les verrous consultatifs sont transactionnels et communs aux connexions de la
même base ; ils sont libérés à la fin de la transaction. Les modes partagé et
exclusif doivent être respectés par tous les participants. Voir
[PostgreSQL 17 — verrous consultatifs](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS).

Cette linéarisation porte sur l'autorisation et les effets PostgreSQL. Elle
ne contrôle pas le transport réseau : un navigateur peut recevoir tardivement
une réponse autorisée avant la révocation. Aucun engagement de retrait d'octets
déjà envoyés ou de synchronisation des horloges réseau n'est ajouté.

## Bornes, erreurs et absence de rejeu métier

Chaque unité utilise `maxWait: 5000` pour obtenir une transaction et
`timeout: 30000` pour sa durée maximale. `SET LOCAL lock_timeout = '5000ms'`
borne chaque attente de verrou PostgreSQL de cette transaction. Ces bornes
ne constituent pas un délai total de cinq secondes pour toute la requête.
Les unités doivent rester courtes ; ni attente réseau utilisateur ni polling
ne doit être ajouté dans le handler protégé.

Prisma 6 permet ces options par transaction et rapporte notamment `P2034`
pour un conflit d'écriture ou un interblocage. La politique de reprise du dépôt
reste plus restrictive que l'exemple générique Prisma : uniquement avant le
handler. Référence :
[Prisma 6 — transactions interactives et conflits](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions).

| Situation | Traitement |
| --- | --- |
| `P2034` avant l'entrée dans le handler | Au plus quatre reprises après la tentative initiale, chacune avec transaction, verrou et autorisation neufs |
| Tentatives techniques épuisées avant le handler | `503 permission_store_unavailable`, aucun handler exécuté |
| Attente de verrou dépassée ou erreur de store non reconnue | `503 permission_store_unavailable`, détails SQL expurgés, pas de boucle de retry |
| Refus HTTP métier explicite | Statut et code canoniques propagés ; notamment absence de révélation intercampus |
| Version optimiste invalide ou conflit de mutation reconnu après entrée dans le handler | `409` conservé ; les erreurs Prisma `P2034`/`P2002`/`P2025` non déjà traduites restent des conflits, sans rejeu automatique |
| Promotion d'une unité de lecture vers une écriture imbriquée | Refus fermé avant l'effet métier |

Le `503` de contention pré-handler ne remplace pas un `409` de vraie version
métier par un succès. Un échec dans le handler annule sa transaction ; il ne
déclenche pas une seconde mutation. Les reçus idempotents, versions métier et
audits restent dans la transaction qui les produisait déjà. Le seed ne possède
pas de boucle de reprise automatique et signale son échec si sa transaction
ne peut aboutir.

## État des preuves

Les tests unitaires de frontière, du registre fermé, des permissions et des
lifecycles ont été exécutés localement : 61 réussites, aucun échec ni test ignoré,
avec lint ciblé et type-check API verts au moment de la rédaction.
Le cycle PostgreSQL local CRMY-170 est également vert, sans test ignoré :
barrières SQL dans les deux ordres, lectures simultanées, changements de droits
et d'identité, révocations sur les deux API, consultations d'audit sans incrément
d'epoch, rollback et conflits optimistes. Le premier accès HTTP sur l'autre API
fait évoluer la version d'authentification de 2 à 3, puis les deux API refusent
les anciennes sessions et le secret temporaire. La régression PostgreSQL
CRMY-169 compte 20 réussites, aucun échec ni test ignoré.
Ces constats ne certifient pas encore les images finales, Sonar ou CI.

La livraison exige les preuves déterministes deux utilisateurs/deux API et
proxy, epoch inchangée en lecture, révocation dans les deux ordres, changements
globaux/campus, rôle/appartenance/activité/responsabilité TEAM, sessions sur
l'autre instance, conflits optimistes, idempotence, rollback et audit.
Les barrières du harnais doivent montrer l'ordre réel des transactions et
l'absence de verrous ou connexions conservés après leur terminaison.

Les résultats finaux doivent être rattachés au head de la Draft PR et aux images
effectivement testées. La référence de couverture locale de 90,92 % précède
cette remédiation et ne constitue pas une certification Sonar du nouveau head.

## Retour au code précédent sans perte de données

Le SHA du commit de cette remédiation sera relevé dans l'audit de publication ;
aucun SHA n'est inventé avant la création du commit. Après publication, un retour
au code doit être un nouveau commit de revert ciblé, soumis aux mêmes contrôles,
par exemple après remplacement du paramètre par le SHA effectivement audité :

```text
git revert <SHA_DU_COMMIT_DE_REMEDIATION_PUBLIE>
```

Cette procédure concerne le code de remédiation, pas l'ensemble des migrations
et fonctionnalités CRMY-170. Elle ne doit pas écraser les modifications locales,
réinitialiser les versions de permission, annuler les révocations commitées,
effacer l'historique, restaurer un disque Docker ou supprimer un volume.
La base et ses données synthétiques restent conservées.

L'ancienne image API et ses preuves restent disponibles comme référence de
retour arrière. Cette image contient le défaut de concurrence connu : elle
reste **NO-GO pour livraison et recette fiable**. Un éventuel retour opérationnel
nécessite une nouvelle décision sur l'usage limité acceptable et une nouvelle
validation ; la conservation de cette image ne vaut pas autorisation de la
présenter comme corrigée. Aucun rollback n'est exécuté par cette documentation.
