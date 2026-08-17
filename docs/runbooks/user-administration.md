# Administration des collaborateurs

Le parcours local permet au seul `SUPER_ADMIN` de créer, filtrer, activer et désactiver un collaborateur. La désactivation révoque immédiatement les sessions et conserve l'historique append-only. Le dernier Super Admin actif est protégé.

La future synchronisation avec Identity Platform reste gelée. Le rollback applicatif remet la version précédente ; les tables additives restent intactes.

Les changements de rôles et périmètres acceptent uniquement un motif contrôlé, exigent une confirmation, enregistrent l’avant/après et révoquent toutes les sessions du collaborateur. Le guard RBAC réserve l’opération au `SUPER_ADMIN`; le dernier Super Admin actif reste protégé.
