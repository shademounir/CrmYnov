# Piste d'audit append-only

L'API enregistre les connexions, déconnexions, révocations et mutations sensibles avec corrélation, identité synthétique ou technique, rôles, session, résultat et IP minimisée. Les champs sensibles et liens complets sont filtrés avant stockage.

Les événements ne disposent d'aucune route de modification ou suppression. L'idempotency key empêche les doublons lors d'une reprise. La consultation est réservée à `AUDITOR` et `SUPER_ADMIN`.

## Rollback

Revenir au code précédent. La table additive reste intacte et inutilisée pour préserver les preuves. Toute suppression ou correction de données exige une intervention `manual-po` distincte et une validation de rétention.
