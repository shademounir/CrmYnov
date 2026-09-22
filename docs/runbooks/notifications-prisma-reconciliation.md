# Notifications — reprise Prisma contrôlée

## Preuve isolée du 22 septembre 2026

Après fusion squash de PR93 (59e80910b2dcdb13628526a2bd2804f6653644a1), la branche Notifications intègre explicitement develop. Le point local backup/pr94-before-develop-20260922-0948 conserve son état antérieur.

La base de recette Notifications conservée contient deux notifications et n'a aucun producteur connecté lors de l'export. La migration 20260916110000_persist_internal_notifications est absente de son historique. L'existence du DDL hors historique est établie ; l'auteur et la commande d'origine ne sont pas attribués sans journal probant.

Sauvegarde privée hors Git : output/pr94-integration-20260922/notifications-before.dump, 253297 octets, SHA-256 d8526031b91b8e98990b10f658019ee450e151104565c1aa6e1e3249622e72bf. pg_dump et pg_restore --list réussis. Restauration effectivement exécutée sur une copie isolée : crmy94_reconcile_copy_20260922. Aucune restauration sur la base source.

Comparaison avec la table créée par le SQL versionné dans crmy94_schema_expected_20260922 : mêmes colonnes, valeurs par défaut, index, clé primaire et contrôle href. Trois CHECK présentent des arbres de casts différents (cast du tableau contre casts de ses éléments) sur les mêmes valeurs autorisées. L'égalité textuelle exacte n'est pas revendiquée avant normalisation.

## Procédure éprouvée sur copie seulement

1. Arrêter les producteurs de la base cible, exporter, vérifier puis restaurer une copie isolée.
2. Appliquer la migration versionnée à une base vide de comparaison.
3. Comparer pg_dump --schema-only --no-owner --no-privileges -t internal_notifications des deux bases (ignorer uniquement les jetons aléatoires restrict/unrestrict du dump).
4. Sur la copie, remplacer dans une transaction les trois contraintes priority_check, type_check et resource_type_check par leur définition littérale du fichier migration.sql. Ne pas reconstruire la définition depuis pg_get_constraintdef : son reparsing conserve une forme différente des casts. Les ADD CONSTRAINT valident toutes les lignes et prennent un verrou de table ; programmer une fenêtre sans producteur pour toute application future.
5. Exiger une comparaison de schéma sans différence, puis comparer toutes les lignes ordonnées avant/après. Résultat : 2 lignes, empreinte de contrôle identique 009eee4caa3d301035fe56c17f6a2fd0 (contrôle de contenu, pas une empreinte de sécurité).
6. Exécuter la commande officielle `prisma migrate resolve --applied 20260916110000_persist_internal_notifications` avec DATABASE_URL pointant uniquement vers cette copie et le schema.prisma de la branche. Aucune écriture directe de _prisma_migrations. La migration existante n'est pas modifiée.
7. `prisma migrate status` confirme 39 migrations et une base à jour. L'intégration PostgreSQL Notifications passe sur la copie : relecture par nouveau service, lecture persistante, rejeu dédupliqué, refus cross-user et audit unique.
8. Une autre base initialement vide, crmy94_empty_20260922, reçoit les 39 migrations via migrate deploy avec succès.

La base de recette source reste inchangée et non régularisée à ce stade. Cette procédure ne justifie aucune résolution sur une autre base sans refaire ses comparaisons.

## Retour arrière

La restauration de l'archive avant régularisation dans une nouvelle base isolée a été exécutée et conserve les données. En cas d'échec avant COMMIT, la normalisation transactionnelle est annulée. Après résolution officielle, conserver l'historique exact et revenir à l'application précédente si nécessaire ; ne pas supprimer la ligne Prisma ni la table. Une bascule vers une restauration exige arrêt des producteurs et revalidation des écritures postérieures à l'export.

## Limites des contrôles

Les contrôles locaux ne sont pas des gates distants. Les 22 tests API conditionnels ignorés ne sont pas annoncés comme exécutés. Le test PostgreSQL ciblé est lancé depuis apps/api pour charger le tsconfig des décorateurs ; un premier lancement depuis la racine a échoué avant exécution, puis le lancement correct a réussi.
