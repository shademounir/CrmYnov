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

## Interface graphique et commandes techniques

Sans argument, l’agent ouvre l’interface graphique « Relation Ynov ». La
première utilisation suit cinq étapes : compte CRM, profil attribué, mot de
passe téléphonique protégé par Windows, audio local, puis disponibilité réelle.
Une fois le profil complet, les ouvertures suivantes arrivent directement sur
le tableau de bord ; le code temporaire n’est plus demandé.

Le Core Liblinphone est initialisé d’abord sans compte SIP pour découvrir et
tester les périphériques. Le test micro utilise l’écho local du SDK et un
vumètre de point de terminaison Windows, sans enregistrer de fichier et sans
changer les réglages Windows. Le son de test utilise le lecteur local
Liblinphone. La connexion SIP n’est lancée qu’après cette configuration.

« Prêt à appeler » exige simultanément : CRM joignable, poste autorisé, SIP
enregistré, microphone sélectionné et sortie sélectionnée. Le retrait du
périphérique retenu est signalé ; pendant un appel il n’est pas remplacé
silencieusement par un autre périphérique.

Le démarrage avec Windows est désactivé par défaut et ne s’active que par la
case dédiée.

- `CrmYnov.TelephonyAgent pair` : association par code temporaire à usage unique ;
- `CrmYnov.TelephonyAgent configure-secret` : saisie locale masquée du mot de passe SIP ;
- `CrmYnov.TelephonyAgent native-check` : charge le SDK sans compte SIP ni appel ;
- `CrmYnov.TelephonyAgent audio-check <rapport.json>` : inventorie les capacités
  audio sans nom ni identifiant de périphérique, sans SIP et sans enregistrement ;
- `CrmYnov.TelephonyAgent audio-probe <rapport.json>` : ouvre brièvement le
  microphone, mesure son niveau et envoie un son local vers la sortie retenue,
  sans SIP, appel ni enregistrement ; l’audibilité reste à confirmer humainement ;
- `CrmYnov.TelephonyAgent run` : enregistre le compte SIP et interroge l'API ;
- `CrmYnov.TelephonyAgent self-test <rapport.json>` : vérifie DPAPI, le journal
  de rejeu et l’export expurgé, sans réseau SIP ni appel.

Pendant `run` : `devices`, `input N`, `output N`, `hangup`, `quit`.

Les commandes console sont conservées pour le diagnostic technique ; le paquet
commercial utilise l’interface graphique et une instance unique par session.

La réception est refusée et aucun enregistrement audio n'est créé. La durée CRM
provient exclusivement des événements `ANSWERED` puis terminal observés par le
SDK ; elle n'est pas certifiée par l'opérateur.

## Paquet pilote, mise à jour et retour arrière

`scripts/telephony-agent/package-windows-agent.ps1` produit un paquet autonome
`win-x64`, son manifeste SHA-256 et une archive des sources de l’agent. Le
paquet est portable : extraire chaque version dans un dossier distinct et
lancer `CrmYnov.TelephonyAgent.exe`. Le fichier DPAPI demeure dans
`%LOCALAPPDATA%\CRM Ynov\Telephony Agent` et survit à une mise à jour.

Pour revenir en arrière : arrêter l’agent, lancer le dossier de la version
précédente conservée et vérifier CRM/poste/SIP avant tout appel. Pour
désinstaller : désactiver le démarrage automatique, quitter l’agent, révoquer
le poste dans le CRM, puis supprimer le dossier du programme. La suppression
du dossier DPAPI est une action distincte et irréversible qui exige une décision
explicite. Le paquet pilote n’est pas signé ; un certificat approuvé reste un
prérequis de production.
