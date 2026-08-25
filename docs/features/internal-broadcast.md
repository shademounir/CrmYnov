# Broadcast interne code-only

CRMY-146 livre un parcours local, testable et strictement interne. Il ne fournit ni Pub/Sub, ni garantie multi-instance, ni connecteur email/SMS. Ces activations restent gelées avec CRMY-87.

## Contrat de sécurité

- seuls `SUPER_ADMIN`, `ADMIN` et un `MANAGER` dans son périmètre peuvent créer un brouillon ;
- l'audience est l'intersection de filtres explicites sur des collaborateurs actifs ;
- la prévisualisation est non mutative et ne retourne qu'un compte ;
- la confirmation exige le consentement explicite, la version et le compte prévisualisés ;
- le snapshot des identifiants internes est figé à la confirmation ;
- la clé d'idempotence et l'unicité `(broadcast_id, user_id)` empêchent les doublons ;
- un `MANAGER` ne peut pas lire le snapshot complet ;
- le texte est borné et rendu inerte par React, tandis que les liens sont limités aux routes internes `leads`, `chat` et `notifications` ;
- l'audit append-only conserve uniquement identifiants techniques, compte agrégé, résultat et motif structuré, jamais le contenu ni une adresse.

## Cycle de vie et rollback

Un brouillon peut être annulé avec un motif avant émission. Après confirmation, il est immuable et ne peut pas être supprimé. Une erreur est corrigée par un nouveau broadcast compensatoire lié à l'original, envoyé au snapshot historique sans recomposition.

La migration Prisma est additive et validée uniquement sur PostgreSQL éphémère. Le rollback code-only revient au commit précédent et recrée la base de test vide. Toute suppression de données ou exécution sur une base persistante requiert une intervention `manual-po` distincte.

## Activation future gelée

CRMY-87 devra décider et livrer la persistance réelle, l'outbox transactionnelle, Pub/Sub et la reprise multi-instance. La présente livraison utilise `LocalBroadcastPublisher`, un adapter synchrone en mémoire adapté uniquement au local et aux tests.
