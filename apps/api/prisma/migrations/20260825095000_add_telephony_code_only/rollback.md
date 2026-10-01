# Rollback local CRMY-148

Le rollback applicatif consiste à revenir la PR. Sur une base PostgreSQL éphémère uniquement, les cinq tables `telephony_*` peuvent ensuite être supprimées dans l’ordre inverse des dépendances. Aucun rollback destructif n’est exécuté automatiquement et aucune base persistante n’est autorisée par CRMY-148.
