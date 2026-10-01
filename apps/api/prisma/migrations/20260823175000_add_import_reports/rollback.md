# Rollback CRMY-59

La migration crée uniquement deux nouvelles tables sans modifier les données ni les tables existantes. Avant activation sur un environnement persistant, le rollback consiste à revenir au commit précédent et à recréer la base PostgreSQL éphémère de test.

Après une future activation persistante, les rapports constituent une preuve d’audit append-only : désactiver les routes et conserver les tables. Toute suppression physique nécessitera une procédure destructive `manual-po` séparée avec sauvegarde, validation Product Owner et preuve de rétention.
