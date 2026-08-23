# Pipeline de statut des leads

Le parcours local autorise `PROSPECT → CONTACTED → QUALIFIED`. Les clôtures `ENROLLED` et `CLOSED_LOST` sont terminales, exigent un rôle `ADMIN` ou `SUPER_ADMIN` et un motif non vide. Chaque transition réussie ajoute un événement `STATUS_CHANGED` immuable à la timeline et un audit corrélé.

Le rollback applicatif consiste à revenir au commit précédent. Aucune migration ni correction silencieuse d'historique n'est nécessaire. Les tests et démonstrations utilisent uniquement des identités synthétiques.
