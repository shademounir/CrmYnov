# Rapport de réconciliation d’import

CRMY-59 conserve un rapport immuable par job et batch d’ingestion. Le rapport référence une version exacte du mapping et le SHA-256 du fichier source sans conserver son nom, son contenu ou une valeur métier.

La somme `created + updated + ignored + duplicates + errors` doit toujours égaler `total`. Dans le pipeline actuel, une provenance rattachée à un lead existant est comptée comme doublon ; les champs canoniques ne sont pas mis à jour silencieusement. `errors` agrège les lignes invalides et en revue manuelle.

L’export CSV des rejets contient exclusivement `line_number`, `category` et `reason_code`. Il ne contient ni nom, email, téléphone, identifiant externe ou contenu de cellule. Les créations sont réservées aux rôles Manager/Admin/Super Admin ; Auditor possède seulement la lecture.

La migration Prisma est additive et se teste uniquement sur PostgreSQL éphémère. Aucun fichier réel n’est importé par les tests ou par la CI.

## Rollback

Avant toute activation persistante, un revert normal du squash retire les routes et modèles. Après une future activation, conserver les tables append-only et désactiver les routes ; toute suppression de table ou de rapport exige une procédure `manual-po` distincte.
