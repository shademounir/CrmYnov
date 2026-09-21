# Rollback — pilote agent Liblinphone

Le retour applicatif désactive les routes et l’agent du pilote. Les tables additives et leurs événements restent conservés afin de préserver l’audit et les commandes déjà corrélées.

Sur une base PostgreSQL éphémère exclusivement, après arrêt des producteurs et vérification de l’absence de données à conserver, les tables peuvent être supprimées dans l’ordre suivant : `telephony_agent_commands`, `telephony_workstations`, `telephony_pairing_codes`, `telephony_user_profiles`, puis `telephony_server_profiles`.

Aucune suppression physique n’est autorisée sur une base persistante par ce rollback. Une migration destructive séparée, sauvegardée et gouvernée en `manual-po`, serait nécessaire.
