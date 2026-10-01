# Chat interne code-only

CRMY-85 livre les conversations directes et d’équipe entre collaborateurs actifs. Chaque lecture et chaque envoi revérifie l’appartenance à la conversation ; une ressource inconnue est masquée par une réponse `404` afin de prévenir les IDOR. Un identifiant de lead ne peut pas être inscrit comme participant parce que chaque membre doit exister dans l’annuaire des collaborateurs actifs.

Les messages sont limités à 2 000 caractères, créés avec une clé d’idempotence client et ordonnés de manière déterministe. L’auteur peut modifier ou supprimer logiquement son message pendant 60 minutes. Une modération après cette fenêtre est réservée à Manager, Admin ou Super Admin et exige un motif. Chaque changement conserve la version antérieure ; l’audit ne contient jamais le texte du message.

Les conversations sans lead portent une échéance initiale de conservation de 12 mois. La purge reste une opération sensible future, hors de cette tranche. CRMY-86 permet de rattacher un fil à un lead visible sans conférer de droit de mutation. Une mention cible uniquement un membre actif du fil et génère une notification interne idempotente. La conversion d’un message en activité officielle est explicite, unique et réservée au responsable, à un collaborateur validé ou aux rôles Manager/Admin ; le lien contextuel seul ne suffit jamais.

Les pièces jointes collaboratives sont une option P2 : elles sont refusées explicitement tant que stockage privé, antivirus, quotas et rétention ne sont pas livrés. Les notifications restent locales et synthétiques ; la diffusion temps réel appartient à CRMY-87.

## Validation locale

Les tests utilisent uniquement des collaborateurs et messages synthétiques. La migration Prisma est additive et doit être appliquée exclusivement à un PostgreSQL éphémère. Aucun Pub/Sub, Cloud SQL, bucket, secret, service externe ou donnée réelle n’est nécessaire.

## Rollback

Revert applicatif protégé de la PR. Les tables additives restent présentes jusqu’à une migration contractuelle séparée et manuellement gouvernée ; aucune suppression de table ni de donnée n’est incluse dans le rollback de CRMY-85.
