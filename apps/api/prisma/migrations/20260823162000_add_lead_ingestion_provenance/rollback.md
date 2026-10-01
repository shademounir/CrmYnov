# Rollback local de la migration d'ingestion

Cette migration additive est testée uniquement sur une base PostgreSQL éphémère vide. Son rollback applicatif consiste à revenir au commit précédent puis à recréer la base éphémère.

Sur un environnement persistant futur, aucune suppression de table n'est automatisée : l'arrêt des écritures, l'export des preuves de provenance et toute opération destructive exigent une procédure `manual-po` séparée.
