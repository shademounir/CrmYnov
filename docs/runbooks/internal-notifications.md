# Notifications internes persistantes

Le centre est strictement interne à l'application. Chaque notification appartient à un destinataire, référence une ressource par identifiant opaque, utilise un chemin relatif allowlisté et possède une clé de déduplication unique. La liste est paginée ; la lecture individuelle et « tout lire » sont idempotentes et auditées sans contenu métier libre. Les notifications, leur état de lecture et les audits sont conservés dans PostgreSQL lorsque l'adaptateur persistant est actif.

Aucun email, SMS, WhatsApp, push ou Pub/Sub n'est envoyé par ce lot. L'accès à la ressource cible reste soumis aux contrôles de la route métier lors de l'ouverture ; une notification ne confère aucun droit supplémentaire. Le rollback applicatif conserve les données et événements d'audit append-only.

Le planificateur serveur fait passer une relance persistante arrivée à échéance de `SCHEDULED` à `DUE` sous verrouillage optimiste, puis crée une notification dédupliquée pointant vers `/leads/{id}/follow-ups`. Cette preuve ne vaut pas validation d'une notification externe ni de tous les autres types de notifications déclarés par le contrat.
