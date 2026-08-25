# Socle téléphonie code-only — CRMY-148

## Architecture

`TelephonyService` dépend du contrat `TelephonyAdapter`. `MANUAL_EXTERNAL` est l’unique adaptateur opérationnel local ; `COOVOX` et `LINPHONE` sont des contrats fail-closed retournant `provider_not_configured`. Le webhook reste désactivé et aucune connexion réseau n’est effectuée.

| Capacité | MANUAL_EXTERNAL | COOVOX | LINPHONE | DISABLED |
| --- | --- | --- | --- | --- |
| Journalisation locale | Oui | Non configuré | Non configuré | Non |
| Click-to-call réel | Non | Gelé | Gelé | Non |
| Événement entrant réel | Non | Gelé | Gelé | Non |
| Métadonnées d’enregistrement | UNAVAILABLE | Contrat seulement | Contrat seulement | UNAVAILABLE |
| Secret requis dans CRMY-148 | Aucun | Aucun | Aucun | Aucun |

Les états sont `REQUESTED`, `RINGING`, `ANSWERED`, `MISSED`, `FAILED`, `CANCELLED` et `ENDED`. Les transitions terminales sont irréversibles ; une erreur se corrige uniquement avec un événement compensatoire. La durée est calculée entre `ANSWERED` et un événement terminal structuré. L’idempotence repose sur `(provider, externalId)` et une clé par événement.

Le rapprochement entrant utilise un téléphone normalisé et son empreinte SHA-256. Zéro correspondance ou plusieurs correspondances alimentent la file **À vérifier**. Une association ambiguë nécessite une confirmation Manager/Admin et ne modifie jamais l’affectation du lead.

Les enregistrements sont limités à un identifiant opaque, un état, une durée, un fournisseur, une référence abstraite facultative et des rôles. CRMY-148 ne produit, ne lit, ne télécharge et ne stocke aucun audio ou URL signée.

## Sécurité et rollback

- aucun numéro complet dans les audits ou vues techniques ;
- RBAC, périmètre campus et anti-IDOR appliqués avant lecture ou mutation ;
- aucune adresse PBX, credential SIP, secret, GCP ou base persistante ;
- webhook réel refusé avec `telephony_webhook_disabled` ;
- rollback : revert protégé de la PR. La suppression des tables n’est documentée que pour une base PostgreSQL éphémère et n’est jamais automatisée.

## Prérequis d’activation future

Coovox : modèle/firmware exact, API officielle, mécanisme CDR, réseau sortant/VPN, identité technique, politique d’enregistrement/rétention et tests isolés. Linphone : licence SDK, packaging poste, provisioning SIP sécurisé, mises à jour, compatibilité OS et validation juridique. Toute activation exige une autorisation Product Owner distincte.
