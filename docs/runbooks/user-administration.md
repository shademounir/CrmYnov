# Administration des collaborateurs

Le parcours local permet au seul `SUPER_ADMIN` de créer, filtrer, activer et désactiver un collaborateur. La désactivation révoque immédiatement les sessions et conserve l'historique append-only. Le dernier Super Admin actif est protégé.

La future synchronisation avec Identity Platform reste gelée. Le rollback applicatif remet la version précédente ; les tables additives restent intactes.
