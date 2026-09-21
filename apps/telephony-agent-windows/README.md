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
tester les périphériques. Le test micro utilise une capture Windows locale en
mémoire pour calculer uniquement un niveau : aucun retour de voix et aucun
fichier audio ne sont produits, et les réglages Windows ne sont pas modifiés.
Une réécoute distincte peut être activée explicitement pour ce test. Elle est
désactivée par défaut, conserve au maximum cinq secondes uniquement en mémoire,
puis les rejoue une fois sur la sortie choisie et efface le tampon. Elle ne crée
aucun fichier et ne forme aucune boucle audio en direct. Le son de test utilise
séparément le lecteur local Liblinphone. La connexion SIP n’est lancée qu’après
cette configuration.

La capture du pilote associe aujourd’hui le périphérique Liblinphone à l’entrée
WinMM par un nom unique. Elle refuse le test si cette correspondance est absente
ou ambiguë, au lieu d’utiliser silencieusement le microphone Windows par défaut.
Cette stratégie sûre reste une limite du pilote pour les noms Windows tronqués ;
une version distribuable devra cibler l’identifiant MMDevice exact via WASAPI.

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
paquet reste utilisable en mode portable : extraire chaque version dans un
dossier distinct et lancer `CrmYnov.TelephonyAgent.exe`.

Pour le pilote installé, `scripts/telephony-agent/install-windows-agent.ps1`
crée sans privilège administrateur l’entrée « Applications installées », le
raccourci du menu Démarrer et le protocole
`crmynov-telephony://command/{id}`. Le protocole ne transporte qu’un UUID : le
numéro est relu côté serveur après authentification du poste. Les versions
restent côte à côte pour un retour arrière explicite. Le fichier DPAPI demeure
dans `%LOCALAPPDATA%\CRM Ynov\Telephony Agent` et survit à une mise à jour.

Une première installation enregistre également l’agent au démarrage de la
session Windows, lance l’assistant d’association et conserve ensuite le profil,
le secret DPAPI et les périphériques choisis. Au premier appel depuis le CRM,
le navigateur peut demander une confirmation de sécurité pour ouvrir le
protocole `crmynov-telephony`. L’utilisateur peut choisir « Toujours autoriser »
pour l’origine CRM attendue ; l’installeur ne contourne pas ce consentement du
navigateur. Les raccourcis téléphone de la fiche passent par le panneau CRM et
non par le protocole Windows générique `tel:`.

Pour revenir en arrière : arrêter l’agent, lancer le dossier de la version
précédente conservée et vérifier CRM/poste/SIP avant tout appel. Pour
désinstaller : désactiver le démarrage automatique, quitter l’agent, puis
utiliser l’entrée Windows de désinstallation. La suppression
du dossier DPAPI est une action distincte et irréversible qui exige une décision
explicite. Le paquet pilote n’est pas signé ; un certificat approuvé reste un
prérequis de production.
