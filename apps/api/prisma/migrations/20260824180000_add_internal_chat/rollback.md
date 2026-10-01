# Rollback CRMY-85

Cette migration est strictement additive : elle crée uniquement les tables, index et clés étrangères du chat interne, sans modifier les données ni les tables existantes. Sur PostgreSQL éphémère, le rollback consiste à revenir au commit précédent et à recréer la base de test vide.

Après une future activation persistante, revenir au code précédent désactive les routes sans supprimer les messages. Toute suppression physique des tables ou des données exigera une migration destructive séparée, classée `manual-po`, assortie des preuves de sauvegarde et de rétention applicables.
