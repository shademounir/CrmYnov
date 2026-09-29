# CRMY-161 — invitation et premier accès DEV

Le compte professionnel existant reste Commercial et limité au campus Casablanca. Cette évolution ne le recrée pas et ne change pas son périmètre. Le transport Gmail est **désactivé par défaut** ; aucun message n'est annoncé comme envoyé avant l'acceptation effective de l'API Gmail.

## Contrat et reprise

L'administrateur crée ou sélectionne le compte dans Administration, puis confirme séparément l'invitation. La création du compte n'envoie rien et reste relisible après échec. Trois réémissions maximum par heure et par compte ; une réémission révoque les liens précédents. Le jeton de 256 bits, distinct d'un secret temporaire, expire après 20 minutes, n'est stocké que sous SHA-256 et se trouve dans le fragment du lien. L'ouverture GET ne le consomme pas. L'API contrôle l'activation dans une transaction sérialisable, marque l'invitation utilisée une fois, écrit le hash du nouveau mot de passe, supprime l'obligation de premier accès et révoque les anciennes sessions. Le navigateur ne retrouve un accès métier qu'après une nouvelle connexion.

Les états `PENDING`, `SENT`, `SEND_UNCONFIRMED`, `USED`, `REVOKED` et l'expiration sont distincts. `SENT` signifie réponse Gmail acceptée, pas réception démontrée. Aucune requête ne doit consigner le jeton, le mot de passe ou le corps de réponse OAuth. La page d'invitation applique `Referrer-Policy: no-referrer` et `Cache-Control: no-store`. L'URL publique est configurée explicitement, jamais construite depuis `Host`.

## Gmail DEV — intervention personnelle requise

Projet autorisé : `crmynov-dev-n7x4q2`. Boîte pilote : `casablancaynovcampus@gmail.com`. Portée OAuth demandée : **`https://www.googleapis.com/auth/gmail.send` seulement**. Aucun compte de service ne peut envoyer comme cette boîte personnelle sans un mécanisme d'administration distinct ; aucune clé longue durée n'est créée.

Après fusion et examen du plan Terraform, créer un client OAuth **Desktop** pour ce projet et réaliser le consentement de la boîte pilote dans une fenêtre Google. Les identifiants du client OAuth doivent être déposés directement comme versions des secrets `crm-dev-gmail-oauth-client-id` et `crm-dev-gmail-oauth-client-secret` ; ne pas les mettre dans Git, une variable Terraform, un ticket ou le chat. Le script local `scripts/dev/gmail-oauth-consent.mjs` lit ces versions en mémoire, ouvre le consentement avec redirect loopback, vérifie l'état OAuth et enregistre le refresh token directement dans `crm-dev-gmail-oauth-refresh-token`. Il n'affiche ni code ni jeton. Ce script n'est pas une preuve de réception d'e-mail.

Une fois le consentement et les trois versions confirmés, appliquer `gmail_invitation_enabled=true` sur DEV seulement. Terraform active Gmail API, accorde au seul compte de service API l'accès aux trois secrets et injecte les versions via Secret Manager. Vérifier la révision Cloud Run API réellement active avant d'envoyer l'invitation au compte existant. Ne jamais activer ce flag tant qu'une version manque. Si l'envoi est incertain, vérifier l'état avant réémission ; ne pas déclarer la boîte destinataire atteinte sur la seule réponse de Gmail.

En mode **Testing** d'un projet OAuth externe, un refresh token peut expirer après sept jours. Une utilisation durable exige l'examen du statut de publication, des utilisateurs de test et, selon le cas, la vérification Google du scope sensible. Pour la production, préférer une boîte institutionnelle dédiée avec un arbitrage de sécurité et d'exploitation. Ce pilote Gmail personnel n'est pas déclaré prêt pour PROD.

## Déploiement et retour arrière

Déployer dans cet ordre : migration additive sur la base DEV existante, API à digest immuable, puis Web compatible à digest immuable. Ne pas restaurer ni réinitialiser la base. Vérifier le lien de session entre les révisions, les refus directs Administration pour Commercial, la portée campus et le nouveau login après activation. La recette réelle nécessite la réception constatée par le destinataire et son consentement au nouveau mot de passe ; un test avec expéditeur simulé ne la remplace pas.

Pour désactiver l'envoi, remettre `gmail_invitation_enabled=false` et redéployer l'API sans effacer les données. Le code antérieur peut fonctionner en gardant la table additive en place ; ne supprimer ni table ni preuves d'audit tant que des invitations émises peuvent exister. Révoquer un compte ou émettre un nouveau secret temporaire révoque ses invitations encore actives. Aucun déploiement PROD implicite.
