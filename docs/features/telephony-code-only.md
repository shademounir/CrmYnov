# Téléphonie persistante et préparation du pilote local — CRMY-148 / CRMY-165

> L'orientation PO du 17 septembre 2026 retient Liblinphone pour le pilote
> interne, sans intégration administrative PBX/Coovox. MicroSIP Lite reste une
> alternative conservée mais non poursuivie. La faisabilité technique ne vaut
> pas validation juridique de la distribution : le choix de licence du code de
> l'agent reste une décision explicite avant toute diffusion.

## Architecture

`MANUAL_EXTERNAL`, `LINPHONE` et `COOVOX` restent des modes distincts. `MANUAL_EXTERNAL` journalise un appel effectué hors CRM. `COOVOX` reste fail-closed. `LINPHONE` utilise un bridge Windows local explicitement appairé ; il ne peut être activé que si le bridge annonce à la fois le SDK chargé et le compte SIP enregistré. Il n’existe aucun repli silencieux entre ces modes.

Le chemin applicatif est `Next.js -> NestJS -> Prisma -> PostgreSQL local`. La configuration, les appels, les événements append-only, les métadonnées d’enregistrement et les accès aux métadonnées sont relus depuis PostgreSQL. Les `Map` du service ne sont plus la source durable : elles sont réhydratées avant chaque lecture ou mutation persistante.

| Capacité | MANUAL_EXTERNAL | COOVOX | LINPHONE | DISABLED |
| --- | --- | --- | --- | --- |
| Journalisation locale | Oui | Non configuré | Non configuré | Non |
| Click-to-call réel | Non | Gelé | Préparé, recette réelle non acquise | Non |
| Événement entrant réel | Non | Gelé | Gelé | Non |
| Métadonnées d’enregistrement | UNAVAILABLE | Contrat seulement | Contrat seulement | UNAVAILABLE |
| Secret requis | Aucun | Aucun | Jeton poste révocable + secret SIP sous DPAPI | Aucun |

Le chemin sortant préparé est `Web -> API CRM <- polling sortant de l'agent Windows -> Liblinphone -> SIP`. L’API relit le numéro depuis le Lead autorisé. Le navigateur n’envoie pas le numéro à composer. L’API persiste d’abord la commande avec `PENDING` et chiffre la destination en AES-256-GCM jusqu'à sa remise unique au poste appairé. Le numéro complet ne figure jamais dans la réponse, les audits ni les erreurs.

L’état de dispatch est distinct de l’état d’appel : `PENDING`, `ACCEPTED`, `UNCERTAIN`, `REJECTED`. `ACCEPTED` confirme uniquement l’acceptation de la commande par le bridge. `RINGING`, `ANSWERED`, `ENDED` et `FAILED` proviennent d’événements SDK authentifiés. Une perte de réponse après la demande devient `UNCERTAIN` et n’entraîne aucune renumérotation automatique.

Les états sont `REQUESTED`, `RINGING`, `ANSWERED`, `MISSED`, `FAILED`, `CANCELLED` et `ENDED`. Les transitions terminales sont irréversibles ; une erreur se corrige uniquement avec un événement compensatoire. La durée est calculée entre `ANSWERED` et un événement terminal structuré. L’idempotence repose sur `(provider, externalId)` et une clé par événement.

Le rapprochement entrant utilise un téléphone normalisé et son empreinte SHA-256. Zéro correspondance ou plusieurs correspondances alimentent la file **À vérifier**. Une association ambiguë nécessite une confirmation Manager/Admin, revérifiée côté serveur dans le périmètre autorisé, et ne modifie jamais l’affectation du Lead. L’interface ne demande aucun UUID technique et ne crée aucun Lead automatiquement.

Les enregistrements sont limités à un identifiant opaque, un état, une durée, un fournisseur, une référence abstraite facultative et des rôles. CRMY-148 ne produit, ne lit, ne télécharge et ne stocke aucun audio ou URL signée.

## Sécurité et rollback

- aucun numéro complet dans les audits ou vues techniques ;
- RBAC, périmètre campus et anti-IDOR appliqués avant lecture ou mutation ;
- aucune adresse PBX, credential SIP, secret, GCP ou numéro complet dans la persistance Téléphonie ;
- réception SIP désactivée ; les événements sortants utilisent un endpoint machine distinct authentifié par un jeton opaque, aléatoire et révocable propre au poste ; seul son condensat est stocké côté serveur ;
- l'agent n'expose aucun port entrant et interroge uniquement l'API CRM ; hors loopback, il exige HTTPS ;
- aucun secret SIP ou d'appairage dans le navigateur, les réponses API ou PostgreSQL ;
- les écritures appel/événement/timeline/audit sont regroupées dans une transaction sérialisable ; les rejouages réutilisent la clé idempotente sans seconde trace métier ;
- rollback applicatif : revenir au runtime précédent en conservant la colonne additive `masked_phone`. Sa suppression est destructive et nécessite une autorisation distincte.

## Preuves locales du 17 septembre 2026

- tests unitaires Téléphonie et bridge : 7 réussis ;
- suite Web complète après ajout du parcours sortant : 165 réussis ;
- compilation TypeScript API et build Docker Web (compilation et type-check
  Next) : réussis. Le contrôle Web hôte après génération de `.next/types`
  reprend sept erreurs historiques d'exports de routes hors Téléphonie ;
- PostgreSQL dédié : création, rejeu, transition terminale, association humaine, audit unique et relecture par une nouvelle instance réussis ;
- les migrations additives Téléphonie et agent ont été appliquées à la base de
  recette par l'opérateur de migration, adoptées dans Prisma, puis relues avec
  le rôle applicatif sans lui accorder de droit général de création de schéma ;
- test PostgreSQL de l'agent : appairage à usage unique, refus du rejeu,
  heartbeat, chiffrement de destination, commande remise une seule fois,
  événement terminal idempotent et révocation du jeton réussis ;
- build Release de l'agent Windows et chargement natif de Liblinphone 5.5.17 :
  réussis, sans configuration SIP ni appel ;
- la validation esthétique personnelle de la file et de l'historique reste ouverte.

## SDK Liblinphone retenu pour le pilote

- Distribution Windows retenue : `linphone-sdk-win64-5.5.17.zip`, téléchargée
  depuis le répertoire officiel stable. SHA-256 de l'archive :
  `EBF8ED33F47B2DC6BEEC7BA65D3735B98C8FB2EAC3A973B68967EDB639A65F62`.
  SHA-256 de `liblinphone.dll` :
  `F48E77FA7D4C9E710D179DAED299D827337955151E67424E21C2D4488623DDAE`.
  Références : <https://download.linphone.org/releases/windows/sdk/> et <https://www.linphone.org/en/liblinphone-voip-sdk/>.
- API : les bindings C# exposent notamment `CoreListener.OnCallStateChanged`, les callbacks d’enregistrement de compte et les périphériques audio. Référence : <https://download.linphone.org/releases/docs/liblinphone/latest/cs/api/Linphone.html>.
- Audio : le SDK distingue les capacités enregistrement/lecture et les périphériques microphone, haut-parleur, casque et Bluetooth. Leur présence et les permissions Windows devront être observées sur le poste de recette ; elles ne sont pas prouvées par le build CRM. Référence : <https://download.linphone.org/releases/docs/liblinphone/latest/c/group__group__audio__devices.html>.
- Réseau : la politique NAT doit être décidée selon l’infrastructure (ICE, STUN ou TURN). Aucun choix automatique n’est déduit du seul compte SIP. Référence : <https://download.linphone.org/releases/docs/liblinphone/latest/c%2B%2B/classlinphone_1_1NatPolicy.html>.
- Sécurité média : TLS protège la signalisation mais ne prouve pas le chiffrement RTP. Liblinphone expose séparément `None`, `SRTP`, `ZRTP` et `DTLS`. La recette doit observer le mode réellement négocié. Référence : <https://download.linphone.org/releases/docs/liblinphone/latest/c%2B%2B/namespacelinphone.html>.
- Licence : les en-têtes du wrapper retenu déclarent AGPL-3.0-or-later et la FAQ
  officielle décrit une double licence AGPLv3/propriétaire. L'archive contient
  aussi des composants tiers avec leurs propres notices. L'agent lie et embarque
  les bindings et bibliothèques natives : séparer le processus du CRM ne tranche
  pas à lui seul les obligations. Les sources correspondantes, notices et moyen
  de mise à disposition doivent accompagner toute distribution selon l'option
  de licence finalement retenue. Référence : <https://www.linphone.org/en/faq/>.
- Poste constaté : le build et le chargement natif sont prouvés. L’enregistrement
  SIP, la numérotation, la sonnerie, le décroché et l’audio bidirectionnel restent
  **non prouvés** jusqu'à la recette réelle autorisée.

### Mapping SDK attendu

| Événement SDK observé | État CRM | Limite |
| --- | --- | --- |
| bridge accepte la commande | dispatch `ACCEPTED`, appel `REQUESTED` | ni sonnerie ni décroché |
| `OutgoingRinging` | `RINGING` | sonnerie distante observée par le SDK |
| `Connected` / média pas encore actif | `ANSWERED` seulement après règle validée | `Connected` ne prouve pas l’audio bidirectionnel |
| `StreamsRunning` | preuve média séparée | ne crée pas un second état métier |
| `End` / `Released` après appel établi | `ENDED` | durée entre `ANSWERED` et fin |
| erreur/refus SIP | `FAILED` | raison technique bornée, sans secret |
| absence de réponse | `MISSED` | uniquement si le SDK/PBX le distingue |

## Prérequis d’activation et de recette réelle

Il faut une décision de licence avant distribution, un compte SIP saisi
localement dans DPAPI, une destination explicitement autorisée et une
disponibilité humaine pour le test audio. Linphone Desktop doit être fermé avant
l'enregistrement du pilote avec la même extension. Il faut ensuite prouver
séparément : enregistrement SIP, numérotation, sonnerie, décroché, média
bidirectionnel, fin, événements reçus et persistance CRM. Aucune étape non
observée n’est validée. Aucun appel réel n’est déclenché avant l’autorisation
explicite de la destination.

Le protocole d'appairage, la procédure de recette et les contraintes de
packaging sont détaillés dans
[`docs/runbooks/linphone-windows-bridge.md`](../runbooks/linphone-windows-bridge.md).
