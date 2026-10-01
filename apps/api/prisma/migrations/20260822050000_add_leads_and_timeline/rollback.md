# Rollback local CRMY-46

Sur une base PostgreSQL éphémère sans donnée réelle, supprimer d'abord `lead_activities`, puis `leads`. Ce rollback n'est jamais exécuté automatiquement sur un environnement persistant.
