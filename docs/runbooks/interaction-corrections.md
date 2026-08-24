# Corrections compensatoires des interactions

Une interaction commerciale est immuable. Une erreur est rectifiée par `POST /leads/{leadId}/timeline/{eventId}/corrections`, jamais par modification ou suppression de l’événement original.

Le client fournit une clé d’idempotence, le nombre de corrections observé (`expectedCorrectionCount`), une opération `CORRECT` ou `CANCEL` et un motif contrôlé. Une correction de valeur n’accepte que des types connus et un résultat contrôlé en majuscules. Les notes libres ne sont jamais recopiées dans l’événement compensatoire ni dans l’audit : leur présence est représentée par `REDACTED`.

Seuls Manager, Admin et Super Admin peuvent corriger, dans un périmètre global ou le campus du lead. Un rejeu retourne le même reçu. Une concurrence, un événement inconnu, une correction de correction ou une activité déjà compensée échoue sans mutation.

## Rollback

Le code peut être reverté par PR protégée. Les événements déjà produits restent append-only ; une nouvelle compensation explicite est requise pour toute rectification ultérieure.
