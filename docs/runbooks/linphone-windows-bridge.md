# Agent Windows Liblinphone — pilote interne CRMY-165

## Statut et réserve de licence

Le pilote utilise l'archive Windows officielle stable
`linphone-sdk-win64-5.5.21.zip` :

- archive SHA-256 : `1C31D2FF9782DCF8732790AAFAC12D56526CD69B6B8A79498D11802DCAC56095` ;
- wrapper C# SHA-256 : `6E5CA4F6E7BF17FC12D4BFF68E534BDDF6154E5D96E07A93BF85CA6711B6416A` ;
- `liblinphone.dll` SHA-256 : `762ACD8FEF393B603BA93C932C631F8DBAAC39F0BAB318606F0751183899FBA7` ;
- `belle-sip.dll` SHA-256 : `71FFAD72BEFC44F99B7CFE1E82B832ED0524F447E29CCD3C689F42F21C95744B`.

Le wrapper déclare AGPL-3.0-or-later. La FAQ Linphone décrit une double licence
AGPLv3/propriétaire ; les composants embarqués portent aussi leurs notices.
L'usage d'un processus séparé ou d'un dépôt public ne constitue pas, seul, une
conclusion de conformité. Avant distribution, il faut décider la licence de
l'agent, produire l'inventaire complet des composants, conserver les sources
correspondantes et fournir notices et modalités de mise à disposition adaptées.
Ce document trace les faits techniques, pas un avis juridique.

## Architecture réellement implémentée

```text
Navigateur -> API CRM -> PostgreSQL
                 ^          |
                 | polling  | commande chiffrée au repos
                 |          v
          agent Windows -> Liblinphone -> compte SIP autorisé
```

- l'agent Windows exécute l'appel dans son propre Core Liblinphone ; il ne pilote
  pas Linphone Desktop ;
- aucun port entrant n'est ouvert sur le poste ; l'agent interroge l'API ;
- un code à usage unique appaire un CRM user et un poste ;
- l'API remet un jeton opaque propre au poste et ne conserve que son SHA-256 ;
- le jeton est révocable ; un seul poste actif et un seul appel actif sont
  admis pour le profil pilote ;
- la destination est relue depuis le Lead après RBAC, chiffrée côté serveur en
  AES-256-GCM et remise une seule fois à l'agent ;
- le mot de passe SIP n'entre jamais dans le navigateur, PostgreSQL, Git ou les
  logs. Il est saisi masqué sur le poste et protégé par DPAPI ;
- le Core Liblinphone utilise une configuration volatile. Le pilote supprime son
  ancien `linphonerc` au démarrage afin d'éliminer les comptes dupliqués et toute
  copie historique du secret ; il ne touche jamais au profil Linphone Desktop ;
- réception et enregistrement audio sont désactivés.

## États et preuves

`PENDING`, `ACCEPTED`, `UNCERTAIN` et `REJECTED` décrivent la remise de la
commande. `ACCEPTED` ne prouve pas la sonnerie. Les états d'appel proviennent
uniquement des callbacks du SDK :

| Observation SDK | CRM | Limite |
| --- | --- | --- |
| commande locale acceptée | `REQUESTED` | ni sonnerie ni décroché |
| `OutgoingRinging` | `RINGING` | sonnerie distante observée localement |
| `Connected` | `ANSWERED` | l'audio bidirectionnel se vérifie séparément |
| erreur/refus terminal | `FAILED` ou `MISSED` si distingué | cause opérateur non certifiée |
| fin après réponse | `ENDED` | durée issue des événements locaux |

La durée CRM est calculée entre les événements `ANSWERED` et terminal observés
par le SDK. Elle n'est pas un CDR opérateur. Chaque événement possède une clé
idempotente durable ; son rejeu ne crée ni seconde activité ni second audit.
Une commande dont le résultat de remise est incertain n'est jamais renvoyée
automatiquement au SDK.

## Construction et installation de recette

1. extraire l'archive officielle vérifiée hors Git ;
2. définir `LIBLINPHONE_SDK_ROOT` vers son dossier `win64` ;
3. construire `apps/telephony-agent-windows` avec .NET SDK 8 ;
4. conserver les DLL natives, plugins, notices et sources correspondantes avec
   le paquet de recette ;
5. exécuter `native-check` avant toute configuration SIP ;
6. depuis `/admin/telephony`, créer le profil serveur, rattacher l'utilisateur
   CRM à son identité SIP, puis générer un code d'appairage à usage unique ;
7. exécuter `pair`, puis `configure-secret` localement ;
8. fermer Linphone Desktop si la même extension est utilisée ;
9. lancer `run`, vérifier le SDK, les périphériques et l'enregistrement SIP ;
10. seulement après autorisation de la destination, activer le sortant et lancer
    un appel depuis la fiche Lead.

Le paquet reproductible est généré par :

```powershell
.\scripts\telephony-agent\package-windows-agent.ps1 `
  -DotnetPath '<dotnet-8>\dotnet.exe' `
  -SdkRoot '<linphone-sdk-5.5.21>\win64' `
  -OutputRoot '<dossier-prive-de-sortie>' `
  -Version '<version-agent-du-projet>'
```

Il est autonome pour `win-x64`, n’exige pas l’installation du runtime .NET et
refuse d’écraser un paquet existant. Son manifeste inventorie les fichiers et
empreintes. L’archive source couvre le code de l’agent et son runbook ; les
sources correspondantes exhaustives de toutes les dépendances natives restent
à constituer avant distribution. La signature Authenticode reste absente du
pilote et obligatoire avant le passage en production.

Le code d'appairage expire après dix minutes et devient inutilisable après la
première consommation. La configuration locale est sous
`%LOCALAPPDATA%\CRM Ynov\Telephony Agent` et reste liée au compte Windows par
DPAPI. Ne jamais copier ce dossier dans un rapport ou une sauvegarde générale.

## Recette réelle progressive

Vérifier séparément : SDK chargé, SIP enregistré, commande unique, sonnerie,
décroché, audio bidirectionnel, raccrochage, durée, timeline et audit uniques,
puis relecture après actualisation et redémarrage de l'API. Tester aussi refus,
absence de réponse, annulation locale, perte de l'agent et rejeu d'un événement.
Un écran « commande acceptée » n'est jamais une preuve d'appel établi.

## Retour arrière et révocation

1. désactiver le sortant dans `/admin/telephony` ;
2. vérifier qu'aucun appel n'est actif ou incertain ;
3. arrêter l'agent ;
4. révoquer le poste depuis le CRM ;
5. supprimer la configuration DPAPI uniquement sur décision de l'utilisateur ;
6. relancer Linphone Desktop normalement.

Aucune donnée historique CRM n'est supprimée. La configuration Linphone Desktop
n'est ni modifiée ni désinstallée par le pilote.
