# Contrat webhook Forminator/Zapier

Le point d'entrée `POST /integrations/forminator/v1/leads` est un adaptateur code-only, désactivé par défaut. Il ne déclenche aucun import avant CRMY-65 et répond toujours `mutated: false`.

## Activation future gelée

- `FORMINATOR_WEBHOOK_ENABLED=true` active explicitement le contrôle ; toute autre valeur conserve le refus `503`.
- `FORMINATOR_WEBHOOK_SECRET` doit être fourni par un gestionnaire de secrets et contenir au moins 32 caractères. Aucune valeur n'est versionnée, journalisée ou renvoyée.
- l'activation Zapier, la rotation, le stockage de replay persistant et le routage réseau restent séparément autorisés.

## Signature

Le producteur trie récursivement les clés JSON, signe avec HMAC-SHA256 la chaîne `<x-forminator-timestamp>.<JSON canonique>`, puis envoie `x-forminator-signature: sha256=<hex>`. La tolérance est de cinq minutes. `x-idempotency-key` est obligatoire et un replay divergent échoue en `409`.

Seuls les champs versionnés de `lead` sont acceptés. Les exemples OpenAPI et tests utilisent exclusivement des identités synthétiques en `.invalid`. L'audit conserve uniquement un digest tronqué, le caractère rejoué et l'absence de mutation.

## Rollback

Remettre `FORMINATOR_WEBHOOK_ENABLED=false` désactive l'adaptateur sans migration ni perte de donnée CRM, puisque cette tranche ne crée aucun lead. Le retrait applicatif consiste à supprimer le contrôleur, le service et le contrat OpenAPI.
