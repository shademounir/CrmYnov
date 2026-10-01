# Agent Windows MicroSIP Lite — orientation de prototype CRMY-165

## Décision recommandée au 16 septembre 2026

La recommandation unique est **MicroSIP Lite portable 3.22.16, non modifié**, piloté
par un agent Windows CRM séparé. Cette option remplace Liblinphone pour le pilote :
elle évite de lier notre agent à l'AGPL, reste légère et expose officiellement la
numérotation en ligne de commande ainsi que les callbacks de connexion et de fin.

Cette décision ne transforme pas Linphone Desktop en composant pilotable. MicroSIP
est un autre client SIP. Linphone et MicroSIP ne doivent jamais enregistrer le même
compte simultanément pendant la recette.

## Vérifications du binaire officiel

Archive examinée depuis `https://www.microsip.org/download/MicroSIP-Lite-3.22.16.zip` :

- version produit : `3.22.16` ;
- archive SHA-256 : `17DCAA628DFD1EA4BA6686C436FB62F42EB9ED124CD671C9D81F3D1580E1207E` ;
- exécutable SHA-256 : `A3832E154EDD84F67C6ABD68508A41447EDA43CE70F4B64746E9AB06092A4636` ;
- 10 fichiers, 12 186 388 octets (11,62 Mio) extraits ;
- signature présente mais auto-signée (`CN=MSIP Code Signing 2025`) : Windows ne
  construit pas une chaîne vers une racine approuvée. Le hash local prouve
  l'identité du fichier examiné, pas une attestation tierce de l'éditeur ;
- `License.txt` contient la GNU GPL v2. Le site officiel confirme que les sources
  sont GPL v2 et que des bibliothèques tierces ne sont pas incluses dans l'archive
  source. Leur inventaire/licence doit être joint au dossier de redistribution.

Le site annonce 13 Mo décompressés et 5–10 Mo de RAM pour Lite. La mesure disque
locale est cohérente ; la RAM n'a pas été mesurée car le binaire n'a pas été lancé.

## Licence et distribution

L'usage et la distribution sans frais de licence sont possibles sous GPL v2. Pour
redistribuer MicroSIP avec l'agent, le paquet devra conserver la licence et les
notices et fournir le code source correspondant, ou une offre écrite conforme,
pour la version distribuée. Les licences des composants tiers doivent aussi être
inventoriées.

L'agent CRM communique avec l'exécutable non modifié uniquement par commandes et
callbacks documentés. Cette séparation rend la frontière plus claire qu'une
liaison à une bibliothèque, mais ne remplace pas une validation juridique du
packaging. Aucune licence du CRM ou de l'agent n'est modifiée par ce spike.

Pour comparaison, le SDK Windows Liblinphone stable identifié est
`linphone-sdk-win64-5.5.21.zip` (environ 300 Mo). Le SDK regroupe Liblinphone,
Mediastreamer2, belle-sip, oRTP et d'autres dépendances. Liblinphone et
Mediastreamer2 sont annoncés en AGPLv3 ; Linphone, bZRTP et bcg729 en GPLv3.
Un agent qui lie Liblinphone doit donc être distribué selon des conditions
copyleft compatibles, avec son code source correspondant, ou sous licence
propriétaire. Un processus séparé n'exonère pas automatiquement le CRM et ne
l'assujettit pas automatiquement non plus : la qualification du travail combiné
reste une décision juridique. Aucun SDK Liblinphone n'est embarqué dans ce spike.

## Architecture du pilote

```text
Navigateur -> API CRM -> commande persistée -> agent Windows loopback
                                              -> MicroSIP.exe destination
                   événement HMAC signé <- callback MicroSIP -> agent
```

L'agent :

- écoute uniquement sur loopback et reprend le contrat HMAC/idempotent déjà
  préparé dans le CRM ;
- refuse une deuxième commande tant qu'une commande sortante n'est pas terminale ;
- refuse de démarrer si Linphone est actif avec le compte de recette ;
- lance `MicroSIP.exe <destination>` sans shell et sans journaliser la destination ;
- conserve localement `commandId`, `callId`, poste, empreinte du téléphone et
  reçus d'événements, sous ACL utilisateur ;
- transmet des événements stables à l'API. Leur rejeu ne crée ni activité ni audit
  supplémentaire ;
- n'expose ni page de configuration SIP ni secret au navigateur ou à l'API.

Les identifiants SIP restent dans le profil portable MicroSIP du commercial. Le
site indique que le mot de passe est stocké chiffré, mais ne documente pas une
protection DPAPI/Windows Credential Manager. Avant déploiement, le profil doit
être protégé par ACL et le mécanisme exact doit être vérifié localement. L'agent
ne copie jamais le mot de passe.

## Événements et niveau de preuve

| Observation locale | État CRM autorisé | Limite |
| --- | --- | --- |
| commande de processus acceptée | dispatch `ACCEPTED` | ne prouve pas l'enregistrement SIP |
| `cmdOutgoingCall` | tentative observée | paramétrage cité au changelog, contrat à vérifier sur 3.22.16 |
| `cmdCallRing` | `RINGING` | ne prouve pas le décroché |
| `cmdCallBusy` | `FAILED`, motif occupé local | ne constitue pas un CDR opérateur |
| `cmdCallStart` | `ANSWERED` | callback documenté, audio bidirectionnel à tester |
| `cmdCallEnd` après `cmdCallStart` | `ENDED` | callback documenté |
| différence Start/End | durée locale observée | pas une durée certifiée opérateur |
| End sans Start, callback absent ou crash | résultat non confirmé | aucune classification inventée |

Les callbacks documentés transmettent l'identité de l'appelant, pas un identifiant
d'appel CRM. La corrélation du pilote repose donc sur **un seul appel sortant actif
par poste**, l'empreinte de destination, le poste et la fenêtre temporelle. Toute
discordance va en revue. Les appels manuels pendant le pilote sont interdits afin
d'éviter une correspondance ambiguë.

Le prototype pur `scripts/telephony-agent/microsip-observation.mjs` matérialise
cette politique sans appeler MicroSIP. Il prouve le rejeu idempotent, la durée
locale après connexion, et le classement `UNCONFIRMED` d'une fin ambiguë.

## Installation, mise à jour et retour arrière

1. conserver Linphone Desktop et ses associations Windows inchangés ;
2. extraire MicroSIP Lite portable dans un dossier privé, sans installer ni
   enregistrer de protocole Windows ;
3. fermer Linphone, vérifier l'absence de processus, puis seulement lancer le
   pilote MicroSIP ;
4. saisir le compte SIP directement dans MicroSIP, hors conversation et journaux ;
5. désactiver réception, réponse automatique, renvoi et enregistrement audio dans
   le profil pilote ;
6. configurer les callbacks vers l'agent et vérifier la séquence sur une unique
   destination autorisée ;
7. en retour arrière : désactiver le mode CRM, terminer l'appel, quitter MicroSIP,
   vérifier sa fin puis relancer Linphone. Aucun profil Linphone n'est modifié.

Une mise à jour est d'abord téléchargée depuis la source officielle, inventoriée
(version, hash, signature, licences), testée sur un poste pilote puis déployée en
remplacement atomique avec conservation de la version précédente. Aucun mécanisme
d'auto-update non contrôlé n'est activé par l'agent.

## Blocage réel avant l'essai

Le binaire a été téléchargé et inspecté mais **jamais exécuté**. Il manque :

1. la destination de recette autorisée et sa disponibilité ;
2. la saisie locale du compte SIP dans le profil portable, sans divulgation ;
3. une vérification empirique sur 3.22.16 des paramètres réellement fournis aux
   callbacks `cmdOutgoingCall`, `cmdCallRing`, `cmdCallBusy`, `cmdCallStart` et
   `cmdCallEnd` ;
4. la validation juridique du paquet de redistribution et des licences tierces.

Si les callbacks ne permettent pas la corrélation sûre avec un seul appel actif,
le pilote s'arrête : aucune lecture de base interne MicroSIP, aucun CDR/PBX et
aucune conversion d'un callback ambigu en preuve certaine.
