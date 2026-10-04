# CRMY-176 — Mon compte / Téléphonie

## Périmètre

Le Commercial (rôle technique `ADMISSIONS`), le Manager et les administrateurs
autorisés disposent d'un écran personnel `/account/telephony`. Ce lot ne donne
pas accès à `/admin/telephony` aux rôles qui n'y avaient pas accès. Le Lecteur
n'obtient pas de nouvelle capacité d'appel. Le serveur reste l'autorité pour les
rôles, les permissions effectives et le périmètre ; masquer un lien n'est jamais
une mesure de sécurité suffisante.

Le profil SIP est attribué et activé par l'administration. L'utilisateur peut
consulter **son** extension et **son** poste, préparer l'association d'un poste
et révoquer sa liaison CRM. Il ne peut pas créer un profil SIP, activer le mode
global, modifier un serveur, attribuer des droits ni agir sur le profil d'autrui.
Les corps de requête ne choisissent jamais l'utilisateur concerné.

## Association guidée

1. Ouvrir « Mon compte · Téléphonie » et relire l'état serveur.
2. Si le profil est absent/inactif, demander sa configuration à l'administration.
3. Si un poste est déjà associé, arrêter l'ancien agent avant une réassociation.
   La révocation de son jeton CRM ne prouve pas la déconnexion physique SIP.
   La révocation est refusée lorsqu'un appel ou une commande non terminés existent.
4. Générer explicitement un code temporaire pour son profil autorisé, puis le
   saisir dans l'assistant local de l'agent déjà installé. Ce code CRM est un
   justificatif sensible à usage unique, distinct du mot de passe SIP : il ne
   doit être placé dans aucune URL, journal, stockage navigateur ou rapport.
5. Configurer le secret SIP et les périphériques exclusivement dans l'agent.
   Relire ensuite les états réellement remontés au CRM.

Un code est limité à dix minutes. L'émission d'un nouveau code invalide les
précédents ; une consommation ou une révocation les rend inutilisables. Les
opérations concurrentes doivent être prouvées sur PostgreSQL, pas déduites de
tests séquentiels. En cas de réponse incertaine, relire l'état avant de recommencer.
Quitter la page invalide ses réponses en vol et retire le code affiché. Un retour
depuis le cache du navigateur relit l'état, sans rejouer automatiquement la mutation.

## États et confidentialité

Le DTO personnel est une liste fermée. Il ne restitue ni mot de passe SIP, ni
jeton d'agent, ni condensat d'authentification, ni référence de secret, ni
configuration du serveur SIP. La présence d'une extension ne prouve pas un
enregistrement SIP. Un ancien heartbeat ne prouve pas une disponibilité actuelle.
Une association CRM, le chargement du SDK et l'enregistrement SIP sont distincts.

`crmynov-telephony://open` ouvre l'interface de l'agent ; il ne constitue ni une
commande d'appel, ni une preuve de sonnerie ou de décroché. Il ne transporte pas
le code temporaire ou un numéro. Une confirmation de sécurité du navigateur peut
être nécessaire. Les préférences audio et de démarrage restent dans l'agent
Windows ; la page CRM ne présente pas de commande sans consommateur effectif.

Les appels restent soumis aux autorisations existantes et à la confirmation
explicite de l'utilisateur. Aucun appel réel n'est nécessaire pour les tests de
ce lot. Le rapprochement de durée repose sur les événements téléphoniques
observés, jamais sur le temps écoulé depuis un clic.

Le rejeu d'un appel manuel conserve le reçu uniquement pour le même propriétaire
et la même intention : émission Liblinphone hors Lead, destination normalisée,
motif et commentaire identiques. Une clé connue appartenant à un autre utilisateur
ou à un appel lié à un Lead produit un conflit fermé, sans reçu étranger ni
nouvelle composition. Cette vérification s'applique aussi au perdant d'une course
de persistance. Les droits d'appel manuel ne sont pas élargis par ce lot.

Pour un appel lié à un Lead, le serveur contrôle son périmètre et relit sa
destination courante avant toute recherche de reçu. Un rejeu exige le même
propriétaire, le même Lead, le même sens/provider et la même empreinte de
destination ; une clé collisionnant avec un appel hors Lead reste un conflit.
Le contrôle s'applique également après une course de persistance perdue.

## Compatibilité et retour arrière

Le protocole machine et le profil Windows protégé existants sont conservés.
Une réassociation au même environnement/profil/identité SIP peut conserver le
secret et les périphériques locaux selon le contrat de l'agent ; un changement
d'origine ne doit pas transférer silencieusement ces secrets.

Le retour arrière applicatif doit conserver les profils, postes, codes expirés
et audits. Ne jamais ressusciter un ancien jeton révoqué ou supprimer l'historique
pour revenir à l'ancienne interface. Le retrait de l'écran personnel laisse
l'administration existante disponible aux seuls administrateurs autorisés.

## Limites conservées

- Réception et enregistrement audio désactivés ; aucune intégration PBX/API/CDR.
- Aucun changement de licence ni installation d'un nouveau SDK.
- Installateur non signé limité au pilote, réserve audio historique conservée.
- Les contrôles API/Web ne certifient pas l'audio du poste ni une nouvelle
  distribution de l'agent Windows.
- Déploiement DEV, acceptation esthétique personnelle et passage PROD restent
  trois décisions distinctes. Aucun résultat de test ou de déploiement n'est
  revendiqué par ce document de contrat seul.
