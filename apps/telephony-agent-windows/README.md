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

### Maintenance du profil — lot de protection

La passerelle configurée est conservée à l'identique (origine, port et chemin).
L'interface affiche son URL HTTPS, sans classer tous les hôtes Cloud Run comme
DEV. Une autre casse du chemin de passerelle compte comme une autre destination :
elle ne reprend pas silencieusement les credentials. Le client refuse les URL
avec identifiants, paramètres ou fragment et ne suit pas les redirections HTTP.

Réassocier le poste ou modifier son secret refuse l'opération pendant un appel
SDK actif. Les événements non acquittés dans le journal bloquent également la
maintenance, y compris après redémarrage. Le profil et le journal sont conservés.
Une commande déjà reçue durant l'arrêt de maintenance n'est pas composée ; son
refus est journalisé. Reconnecter ensuite le poste demeure une action explicite.
La garde couvre toute la mutation asynchrone (association incluse) ; Connecter,
le protocole et une seconde mutation ne peuvent pas la lever. Une demande CRM
déjà en vol fait refuser la maintenance sans interrompre sa requête.

Avant la création d'un appel manuel, le journal conserve une intention opaque
(sans numéro ni secret). Elle est résolue après reçu/traitement de la commande ou
refus HTTP déterministe. Un timeout, une réponse invalide ou un résultat serveur
incertain conserve cette intention après redémarrage et bloque nouvelle demande
et modification du profil : le reçu doit être rapproché avant déblocage, sans
rejeu automatique ni effacement du journal. « Vérifier les demandes en attente »
consulte le reçu via la passerelle HTTPS sans connecter le SDK, réclamer une
commande ou composer. Seul un reçu du même acteur/poste/profil, dont la commande
est terminale avec appel terminal, ou expirée sans avoir été livrée, peut résoudre
l'intention locale. Absence, livraison ou résultat incertain restent bloquants.
La vérification refuse un appel actif ou des événements non acquittés ; elle
exclut les changements de profil et nouvelles compositions pendant sa durée.
Une expiration non livrée peut laisser le dossier serveur REQUESTED : résoudre
l'intention ne termine pas ce dossier et ne lève pas la garde serveur de retrait.
Le jeton courant est revalidé ; le reçu n'atteste pas une génération historique
de commande, absente du modèle actuel. Ne pas revenir à un agent antérieur qui ignore
ces intentions pendant qu'une telle incertitude existe.

Les commandes CLI utilisant le profil acquièrent la même exclusion d'instance
que l'interface. `pair` et `configure-secret` refusent aussi un journal non
acquitté ; elles ne constituent pas un contournement de l'interface ouverte.

Ce lot ne supprime pas encore le profil SIP et ne constitue pas une révocation
serveur. Le retrait complet exige un reçu serveur sûr, idempotent, lié au poste
et à sa génération, puis une désinscription SDK confirmée avant retrait des seuls
credentials locaux. Un simple HTTP 401/403 ou une panne réseau ne prouve pas cette
révocation. Ne pas effacer manuellement le journal pour contourner la garde.

Les extensions internes et l'autorisation d'appels internationaux hors Maroc
restent hors de ce correctif. Elles requièrent un contrat de destination typé et
des permissions serveur : aucun élargissement implicite de la validation actuelle.

`scripts/telephony-agent/test-maintenance-policy.ps1` compile les politiques
managed et les teste sans SDK, réseau, profil réel ou microphone. Le `self-test`
du binaire teste aussi le refus réel de maintenance sur journal synthétique et
le blocage du protocole/composer pendant maintenance. Ces preuves ne certifient
ni la désinscription SIP, ni l'audio, ni l'installateur non signé.

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

Une première installation laisse le démarrage Windows désactivé,
lance l’assistant d’association et conserve ensuite le profil,
le secret DPAPI et les périphériques choisis. Au premier appel depuis le CRM,
le navigateur peut demander une confirmation de sécurité pour ouvrir le
protocole `crmynov-telephony`. L’utilisateur peut choisir « Toujours autoriser »
pour l’origine CRM attendue ; l’installeur ne contourne pas ce consentement du
navigateur. Les raccourcis téléphone de la fiche passent par le panneau CRM et
non par le protocole Windows générique `tel:`.

Pour revenir en arrière : arrêter l’agent, lancer le dossier de la version
précédente conservée et vérifier CRM/poste/SIP avant tout appel. Une première
installation laisse le démarrage Windows désactivé ; l'utilisateur l'active
explicitement dans le diagnostic. Une mise à jour ou un rollback conserve ce
choix et actualise uniquement le chemin de la version active. La connexion SIP
reste une action explicite depuis l'agent. Pour
désinstaller : désactiver le démarrage automatique, quitter l’agent, puis
utiliser l’entrée Windows de désinstallation. La suppression
du dossier DPAPI est une action distincte et irréversible qui exige une décision
explicite. Le paquet pilote n’est pas signé ; un certificat approuvé reste un
prérequis de production.
