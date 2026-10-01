# Rollback applicatif

Revenir à la version applicative précédente. La table additive `internal_notifications` et ses index restent présents mais inutilisés afin de préserver l’historique de lecture et les preuves d’audit.

Avant toute suppression ultérieure, exporter et vérifier les notifications encore utiles, puis confirmer qu’aucun producteur applicatif ne dépend de la table. La suppression de la table ou de ses données est destructive et nécessite une intervention distincte, explicitement autorisée.
