# CRMY-170 — Partage et révocation des vues

Complément de CRMY-52, lié à CRMY-136/169/54. Un propriétaire unique conserve
la définition. TEAM désigne un `TeamResponsibility` actif persisté ; CAMPUS
est résolu par le resolver canonique existant (UUID/code/libellé unique).
Les UUID sont dédupliqués avant `id IN`, sans conversion SQL en texte ni OR
sur les libellés. Référence inconnue/ambiguë/inactive : refus contrôlé.
Une liste vide n'est jamais globale ; Super Admin GLOBAL est traité séparément.

## Capacités

`lead.edit` et `lead.view` restent utilisés pour les vues privées, leur édition
et leur duplication. Les capacités supplémentaires sont `lead.views.view`,
`lead.views.share.team`, `lead.views.share.campus`, `lead.views.revoke.own`,
`lead.views.revoke.team`, `lead.views.revoke.campus`.

Défauts : Super Admin GLOBAL ; Admin CAMPUS ; Manager partage TEAM sous
responsabilité explicite, aucun partage CAMPUS ; Conseiller sans partage par
défaut ; AUDITOR sans mutation. Les plafonds globaux/campus restent appliqués.
Les anciennes configurations complètes sont lues sans réécriture : les nouvelles
capacités y valent NONE. Leur activation requiert une nouvelle configuration
autorisée dans le registre CRMY-169, sans backfill ni écrasement historique.

### Arbitrage PO — configuration et exécution séparées

Le droit administratif nommé `roles.permissions.manage` dans le registre fermé
CRMY-169 est requis avant toute configuration (aucune nouvelle clé ou alias
`settings.manage`). Un Admin autorisé dans son campus peut déléguer OWN, TEAM
ou CAMPUS dans ses plafonds administratifs et ceux du rôle cible ; jamais GLOBAL,
un rôle réservé ou un autre campus. Super Admin peut gérer GLOBAL sous les
plafonds et protections existants. Une permission de gestion retirée ou un
plafond désactivé continue de refuser l'opération.

Le validateur de délégation compare ces plafonds, sans exiger une propriété
de ressource métier. Il ne réévalue pas `revoke.own` avec `own=false` pour décider
si OWN est configurable. À l'exécution, `lead.views.revoke.own=OWN` exige toujours
le propriétaire réel : own=false reste refusé. Aucune modification du resolver,
de PermissionService ou des intersections runtime OWN/TEAM ; ces ensembles
restent distincts (une collaboration n'implique pas l'appartenance TEAM).
Historique et audit sont conservés, y compris les grants OWN préexistants.

## Parcours Ynov V2

Dans Leads, créer une vue privée puis utiliser « Partage des vues » : choisir
sa vue et une audience fournie par l'API, puis confirmer. Une mise à jour
explicite remplace le nom et les filtres courants avec `expectedVersion`.
Un destinataire ouvre le lien `sharedViewId` : la définition et les droits du
lecteur sont relus côté serveur à chaque exécution. Les filtres ne transportent
jamais les permissions du propriétaire. Il peut créer une copie privée nommée
si son grant le permet. Révocation et archivage demandent confirmation.
Un conflit impose une actualisation et une nouvelle confirmation.

Les anciens DELETE restent valables seulement pour les vues jamais partagées.
Une vue ayant un historique de partage doit être archivée explicitement ;
les destinataires perdent immédiatement l'accès. Les cartes sont verticales
sur mobile, cibles 44 px, focus visible, statuts et erreurs annoncés.

### Métadonnées minimales du propriétaire et des audiences

`Collaborator.professionalDisplayName` est nullable, VARCHAR(120), sans défaut,
backfill, index ni unicité. Seul le flux existant POST /users accepte ce champ
facultatif, sous ses contrôles Super Admin et permissions inchangés. Les espaces
externes sont retirés ; vide/absence/NULL deviennent NULL ; types non textuels,
caractères de contrôle et noms trop longs sont refusés. Aucun nouvel endpoint de
profil ni changement du flux d'autorisation. L'audit de création conserve seulement
`displayNameProvided`, pas le nom ; les réponses générales des utilisateurs ne
retournent pas ce champ. Aucun nom n'est dérivé d'un email ou inventé.

Les lectures existantes /view-sharing/received et /view-sharing/views/{id}
ajoutent `ownerDisplayName`, `isOwner`, `visibleAudiences` (type TEAM/CAMPUS et
libellé seulement), `canEdit`, `canRevoke`, `canDuplicate`. Les reçus de mutation
ne stockent pas ces capacités : elles sont recalculées avec PermissionService.
Un nom absent, désactivé, invalide ou hors périmètre devient « Utilisateur
indisponible ». Ni email, UUID du propriétaire, rôles, grants ni session exposés.
Les audiences actives autorisées sont agrégées sans dupliquer une vue ; une
audience révoquée, une autre équipe non accessible ou un campus extérieur reste
masqué. Les administrateurs restent soumis à leurs plafonds effectifs.

Le client enrichit sa liste privée via le GET autorisé existant, séquentiellement
pour éviter une rafale de transactions concurrentes. Il ne déduit aucune capacité
du rôle. Les actions interdites sont absentes, avec revérification au backend.
Les badges textuels restent lisibles sans couleur, y compris sur mobile.

## Atomicité et preuves

Les partages, versions, reçus idempotents et audits sont dans la même transaction
PostgreSQL, sous la barrière multi-instance CRMY-169. Pas de cache permissif.
Audit : acteur authentifié, action, ressource, campus, corrélation et version ;
aucun nom de vue, contenu de filtre, mot de passe, token ou session.

Commandes depuis `apps/api`, dans un processus enfant isolé :

```powershell
node --import tsx --test test/view-sharing-audiences.test.ts
$env:CRMY170_EPHEMERAL_TEST = 'true'
node --import tsx --test test/view-sharing-postgres.test.ts
```

Le harnais compile Nest, crée exclusivement son PostgreSQL tmpfs local et deux
API, authentifie six comptes synthétiques et respecte 5 connexions/60 secondes :
429 obligatoire puis une unique tentative après expiration réelle (+250 ms).
Il retire uniquement son conteneur. Aucun fichier d'import ni donnée réelle.
La faute d'audit est un trigger de test temporaire, jamais une migration livrée.

Les migrations additives ajoutent deux tables et deux colonnes nullables. Le rollback
applicatif est documenté à côté de la migration : ne pas remettre une ancienne
version ignorant les révocations/archives. Conserver les tables et l'historique ;
privilégier une correction en avant sans réactivation silencieuse.

## Périmètre de mesure c8 / Sonar

La commande canonique `npm run test:coverage`, également appelée par la CI,
utilise c8 verrouillé 10.1.3 avec `--exclude-after-remap`. Les exclusions `dist`
et `test` sont appliquées après remappage : les deux API Nest compilées sont
attribuées aux sources TypeScript, jamais comptées simultanément comme JS et TS.
Les listes include/exclude, seuils, source maps et exclusions de couverture Sonar
ne changent pas. Les rapports sont produits nativement par c8, sans édition LCOV.

`apps/**/test/**/*.ts` appartient explicitement au périmètre TEST de Sonar,
y compris les helpers PostgreSQL sans suffixe `.test.ts`. Ces helpers ne sont
pas renommés et ne deviennent pas des suites autonomes. Sonar applique les
inclusions TEST comme exclusions MAIN. Le contrôle générique
`scripts/ci/tests/coverage-scope.test.mjs` vérifie les conventions test/source,
la commande canonique, la version verrouillée et son utilisation par la CI.

La mesure locale doit comparer les inventaires LCOV avant/après, refuser les
doublons et les sources modifiées absentes, et conserver les fichiers sans
couverture. L'estimation conserve prudemment les fichiers `e2e/*.spec.ts` :
aucune exclusion opportuniste n'est ajoutée. Les intégrations PostgreSQL
conditionnelles sont exécutées explicitement sur des bases synthétiques neuves ;
leurs données V8 sont collectées avec celles de la suite officielle avant le
rapport natif. Ne pas mélanger des sources ou des révisions différentes.

La mesure locale ne remplace pas l'indexation et le Quality Gate SonarCloud du
head publié. Vérifier alors le helper en TEST et le service en MAIN. Les changements
de configuration sont soumis au classificateur pr-policy sans contournement ;
une classification manual-po impose une Draft et une revue humaine.
