# Outbox transactionnelle locale

CRMY-153 introduit une outbox PostgreSQL locale. L'événement minimal est écrit dans la même transaction Prisma que la mutation métier. Aucun broker, webhook, appel externe, contenu libre, email ou téléphone n'est transporté.

## Contrat

Les topics versionnés couvrent les leads, relances, notifications, rendez-vous, messages, mentions et broadcasts. Une clé d'idempotence unique interdit le double enregistrement. Les consommateurs prennent un lease optimiste, incrémentent un compteur de tentatives et appliquent un backoff exponentiel borné. Un lease expiré est récupérable après redémarrage ; deux workers ne peuvent pas acquitter le même événement.

Les états sont `PENDING`, `PROCESSING`, `DELIVERED` et `FAILED`. Le payload est limité à 8 000 octets et refuse les clés susceptibles de contenir une identité, un message libre ou un secret. Les logs et erreurs utilisent uniquement des codes stables expurgés.

## Exploitation locale et rollback

La migration additive s'exécute uniquement sur PostgreSQL local ou éphémère. Le rollback applicatif consiste à arrêter le worker : les événements restent conservés pour diagnostic et rejeu contrôlé. En environnement éphémère de CI, la base peut être recréée. Aucune suppression de table, mutation de données, connexion persistante, activation Pub/Sub, DLQ, téléphonie réelle ou opération cloud n'est incluse.
