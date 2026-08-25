# Rollback CRMY-146

Cette migration est strictement additive et ne s'exécute que sur PostgreSQL éphémère dans cette livraison. Le rollback applicatif consiste à revenir au commit précédent puis à recréer la base de test vide.

Après une future activation persistante, le retour au code précédent désactive les routes sans supprimer les broadcasts ni leurs snapshots. Toute suppression physique exigerait une migration destructive séparée, des preuves de rétention et une validation `manual-po`.
