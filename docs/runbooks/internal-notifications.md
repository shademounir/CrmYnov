# Notifications internes code-only

Le centre est strictement interne à l'application. Chaque notification appartient à un destinataire, référence une ressource par identifiant opaque, utilise un chemin relatif allowlisté et possède une clé de déduplication. La liste est paginée ; la lecture individuelle et « tout lire » sont idempotentes et auditées sans contenu métier libre.

Aucun email, SMS, WhatsApp, push, Pub/Sub, secret, donnée réelle ou base persistante n'est utilisé. L'accès à la ressource cible doit être revérifié côté API au moment de l'ouverture. Le rollback applicatif conserve les événements d'audit append-only.
