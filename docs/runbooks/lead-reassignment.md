# Réaffectation contrôlée d’un lead — CRMY-94

Le propriétaire courant crée une demande avec cible, motif, clé d’idempotence et décision explicite sur les tâches ouvertes. La propriété reste inchangée tant qu’un `MANAGER`, `ADMIN` ou `SUPER_ADMIN` distinct n’a pas approuvé. Un rejet est historisé sans mutation de propriété.

L’API refuse les accès hors ownership, l’auto-approbation, les demandes concurrentes, une cible inéligible et toute évolution du propriétaire entre demande et décision. L’ancien et le nouveau propriétaire figurent dans la timeline append-only et l’audit expurgé.

La migration est additive et testée uniquement sur PostgreSQL éphémère. Le rollback applicatif conserve les décisions historiques ; aucune base persistante, notification externe, donnée réelle ou opération cloud n’est utilisée.
