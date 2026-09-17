# Agent Windows Téléphonie CRM Ynov — pilote Liblinphone

Ce pilote exécute les appels sortants dans **son propre Core Liblinphone**. Il ne
pilote pas Linphone Desktop. Avant un essai utilisant la même extension, quitter
Linphone Desktop normalement afin d'éviter deux enregistrements SIP concurrents.

Le SDK 5.5.21 retenu déclare notamment AGPL-3.0-or-later pour son wrapper et
embarque des composants tiers. Ce pilote n'est pas encore un paquet de
distribution approuvé : le choix de licence de l'agent, l'inventaire complet,
les notices et la mise à disposition des sources correspondantes restent à
valider avant toute diffusion.

Le poste ouvre uniquement des connexions sortantes vers l'API CRM. Aucun port
entrant n'est exposé. Le jeton d'appairage et le mot de passe SIP sont chiffrés
avec Windows DPAPI sous le compte de l'utilisateur. Le journal local ne contient
ni destination complète ni mot de passe et empêche une seconde numérotation
après un redémarrage incertain.

## Construction locale

Définir `LIBLINPHONE_SDK_ROOT` vers le dossier `win64` de l'archive officielle
5.5.21, puis utiliser .NET SDK 8. La construction copie les DLL natives et les
plugins nécessaires dans le dossier de sortie ; elle ne modifie pas Linphone
Desktop.

Le Core utilise une configuration volatile : le compte SIP est recréé une seule
fois par processus et aucun mot de passe n'est écrit dans `linphonerc`. Une
ancienne configuration de pilote ayant pu contenir un secret en clair est
supprimée au démarrage ; `settings.dpapi` reste l'unique stockage du secret.

## Commandes

- `CrmYnov.TelephonyAgent pair` : association par code temporaire à usage unique ;
- `CrmYnov.TelephonyAgent configure-secret` : saisie locale masquée du mot de passe SIP ;
- `CrmYnov.TelephonyAgent native-check` : charge le SDK sans compte SIP ni appel ;
- `CrmYnov.TelephonyAgent run` : enregistre le compte SIP et interroge l'API ;
- sans argument : affiche l'état local sans secret.

Pendant `run` : `devices`, `input N`, `output N`, `hangup`, `quit`.

La réception est refusée et aucun enregistrement audio n'est créé. La durée CRM
provient exclusivement des événements `ANSWERED` puis terminal observés par le
SDK ; elle n'est pas certifiée par l'opérateur.
