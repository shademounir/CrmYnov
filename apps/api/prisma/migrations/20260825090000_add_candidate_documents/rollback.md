# Rollback local CRMY-147

Cette migration additive n'est exécutée que sur PostgreSQL éphémère. Le rollback applicatif consiste à revenir au commit précédent et à recréer la base éphémère. Aucune suppression SQL n'est automatisée et aucune base persistante n'est ciblée.
