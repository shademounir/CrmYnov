# CRMY-44 — recette synthétique des référentiels

## Parcours

1. Se connecter avec une session synthétique Super Admin existante. Aucun mot de
   passe n'est fourni ou enregistré dans ce document.
2. Ouvrir `/admin/references`. Créer le campus synthétique en utilisant le code
   de campus attribué aux comptes de recette. Créer les programmes B1/B3/M1 et
   leurs libellés validés, puis activer leur disponibilité par campus. Créer les
   bourses 20/30/40, campagnes et tags autorisés.
3. Créer un lead depuis `/leads/new` avec les listes actives. Rejeter une valeur
   inconnue en appel direct : HTTP 422, code stable, aucune valeur personnelle
   dans l'erreur. Les trois références peuvent être modifiées depuis la fiche
   via `/leads/{id}/references` ; les autres champs ne sont pas modifiés.
4. Ouvrir `/leads/{id}/tags`. Ajouter, remplacer et retirer un tag avec un Manager
   du campus. Vérifier le refus pour un Conseiller qui voit le lead sans en être
   propriétaire/collaborateur actif, puis le succès avec collaboration active.
5. Archiver une définition. Elle disparaît des nouvelles sélections ; un tag
   déjà associé reste affiché avec la mention archivée. Restaurer explicitement
   la définition, vérifier les versions et l'audit.
6. Contrôler un import synthétique à deux lignes : une référence connue, une
   inconnue. La seconde reste À vérifier. Corriger puis soumettre un nouveau lot
   avec une nouvelle clé ; rejouer ce même lot ne crée aucun doublon.
7. L'inventaire LEGACY n'est jamais automatique : lire sa description puis le
   confirmer explicitement comme Super Admin. Vérifier que les champs Lead sont
   strictement identiques avant/après. Ne pas exécuter avec des données réelles
   sans une autorisation dédiée.

## Commandes de validation

Depuis la racine du dépôt : `npm run lint`, `npm run type-check`, `npm run build`,
`npm run test:unit`, `npm audit`, `npm run security:scan`,
`npm run security:history`, `git diff --check`.

Navigateur : `npm run test:e2e:browser --workspace=@crm/web -- test/e2e/references.test.ts`.
Le harnais démarre son propre serveur ; un port 3000 occupé doit être traité par
un serveur de test isolé et `CRM_LOCAL_WEB_URL`, jamais en arrêtant une stack
de recette utilisée par l'équipe.

Pour le test PostgreSQL, préparer une base vide `crm_crmy44` sur PostgreSQL
éphémère local, appliquer les migrations uniquement à cette base, puis depuis
`apps/api`, définir `CRMY44_EPHEMERAL_TEST=true` et un `DATABASE_URL` pointant
explicitement sur cette instance. Exécuter
`node --import tsx --test test/integration/reference-postgres.test.ts test/integration/reference-api.test.ts`.
Le test refuse un hôte non local ou un autre nom de base. Il n'utilise ni import
réel ni compte cloud ; les données restent dans l'instance de test jetable.

## Points de revue PO

- Les rôles techniques ne sont pas renommés ; seuls les libellés métier changent.
- Les Admin ne peuvent pas gérer les définitions globales.
- Les valeurs historiques et les alias ne sont jamais réécrits silencieusement.
- Les scopes déjà utilisés ne sont pas déplacés sans une opération métier dédiée.
- La future story CRMY-169 n'est pas implémentée.
- Aucun bouton ou endpoint de suppression de lead n'est introduit.

## Limites de l'analyse SQL et preuve PostgreSQL

Le premier scan Sonar de la PR CRMY-44 a appliqué des règles `plsql` à la
migration PostgreSQL. La recommandation `VarcharUsageCheck` demande `VARCHAR2`,
un type Oracle : elle n'est pas applicable au dialecte utilisé. PostgreSQL
documente `VARCHAR(n)` comme alias SQL standard de `CHARACTER VARYING(n)` :
[documentation officielle](https://www.postgresql.org/docs/current/datatype-character.html).
La migration a été appliquée à PostgreSQL éphémère ; les contraintes, le
rollback transactionnel et les écritures concurrentes sont testés réellement.

La répétition des littéraux `GLOBAL`/`CAMPUS` dans les contraintes DDL est
également signalée par `plsql:S1192`. Ces contraintes protègent chaque table ;
introduire une constante PL/SQL ou retirer une contrainte serait incorrect.
Ces constats restent visibles pour la revue humaine, avec cette justification,
sans exclusion de fichier, changement de Quality Gate, suppression de règle ni
marquage automatique de faux positif. Une éventuelle correction de la
classification du dialecte Sonar relève d'une intervention séparée.
