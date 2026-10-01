# Rollback local contrôlé

Cette migration additive n'est jamais annulée automatiquement sur une base persistante.
Pour un environnement local ou CI éphémère, supprimer puis recréer intégralement la base synthétique.
Le rollback applicatif consiste à arrêter le worker local ; les événements restent conservés pour audit.
