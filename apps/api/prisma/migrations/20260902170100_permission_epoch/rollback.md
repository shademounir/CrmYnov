# Rollback applicatif CRMY-169

Table technique additive, vide à la migration. Le serveur crée la ligne de
sérialisation lors de sa première transaction protégée. Aucune donnée métier.
Conserver la table et les versions de permissions ; aucune suppression SQL.
Un retour au fournisseur statique rétablirait des droits révoqués : interdit
automatiquement. En cas d'incident, refuser les accès et appliquer un correctif
forward ou restaurer une version autorisée par la commande auditée.
Validation exclusivement sur PostgreSQL éphémère, sans base distante.
