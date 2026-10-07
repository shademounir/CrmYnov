# CRMY-40 — origine des mutations navigateur BFF

Les Route Handlers `/api/crm/*` et `POST /api/logout` contrôlent explicitement
l'origine des mutations. Le contrôle Next.js des Server Actions ne s'applique
pas automatiquement à ces handlers. Le cookie `HttpOnly`, host-only,
`SameSite=Strict`, `Secure` du runtime HTTPS reste une défense complémentaire.
Les sous-domaines frères ne sont pas réputés fiables.

## Contrat

- `CRM_PUBLIC_ORIGIN` est obligatoire à l'exécution du Web pour les mutations.
  Sa valeur doit être une origine HTTPS canonique, sans chemin, userinfo,
  query, fragment ou wildcard. HTTP est admis uniquement pour une origine
  loopback locale explicitement configurée, dont le port exact fait partie
  du contrat. Aucun `Host`, `Forwarded` ou `X-Forwarded-Host` reçu n'en tient lieu.
- `POST`, `PUT`, `PATCH` et `DELETE` exigent un `Origin` exactement égal à cette
  origine. Si `Origin` manque, un `Referer` parsé de la même origine est admis.
  Un `Origin` présent mais hostile ou `null` n'est jamais remplacé par un Referer.
  L'absence des deux entraîne un refus, y compris pour un client HTTP scripté.
- Fetch Metadata, lorsqu'il existe, doit annoncer `same-origin` ou `none`.
  `same-site`, `cross-site` et les valeurs invalides sont refusées. Son absence
  ne désactive pas le contrôle d'origine.
- Une origine source refusée retourne `403 browser_origin_refused` ; une
  configuration absente/invalide retourne `503 browser_origin_unavailable`.
  Ces refus `no-store` interviennent avant lecture du cookie ou appel IAM/API.
- Le garde couvre également connexion, invitation et récupération anonymes.
  Il ne remplace ni les secrets, leur usage unique et expiration, ni le RBAC.
- Si une mutation `/api/crm/*` possède un corps, elle exige `application/json`
  avec éventuellement un charset UTF-8. Un formulaire simple ou `text/plain`
  n'est pas réétiqueté JSON : `415 request_json_required`. Un JSON invalide
  retourne `400 request_json_invalid`, un corps dépassant 1 Mio retourne `413`.
  Après le contrôle d'origine et avant cookies/IAM/API, les octets réellement
  reçus distinguent un corps JSON d'un flux vide : l'adaptateur Node de Next
  fournit aussi un flux non nul pour les requêtes sans corps. Ni sa présence
  ni `Content-Length` ne suffit à prouver un corps. Zéro octet n'est ni parsé
  ni envoyé en amont et n'impose pas de Content-Type ; les POST réellement
  sans corps (raccrocher) et DELETE sans corps exigent toujours une origine
  et une session valides. La lecture conserve au plus 1 Mio de chunks ; dès
  le premier chunk non vide de type interdit ou le dépassement de la limite,
  le flux restant est annulé avant lecture des identités ou appel API.
- Le logout conserve son formulaire HTML POST, la suppression des cookies,
  une redirection relative et `no-store`. Il n'exige pas de corps JSON.

## Frontières inchangées

Le gateway `/agent/*` ne lit pas la session navigateur : il utilise le token
natif explicite, une liste de chemins bornée et l'autorité métier de l'API.
Il doit fonctionner sans Origin ni cookie ; poll/claim peuvent être sans corps.
Le garde navigateur ne lui est pas appliqué. L'identité Cloud Run reste distincte
des Bearer applicatifs ; l'API et PostgreSQL ne sont pas rendus publics.

Le consentement Gmail reste un callback loopback avec `state` vérifié. Les liens
d'invitation/récupération utilisent l'origine API approuvée et un fragment privé.
Aucun token DEV, cookie ou secret SIP n'est transféré à PROD par ce correctif.

## Configuration et validation

Compose exige la variable et l'exemple synthétique utilise `http://localhost:3000`.
Une autre adresse/port de navigateur impose une configuration correspondante ;
`localhost` et `127.0.0.1` ne sont pas la même origine. La preview Playwright
déclarée configure explicitement son origine. Terraform DEV transmet la même
origine approuvée au Web et à l'API, sans élargir la restriction DEV existante.

Les tests `browser-origin*`, `api-proxy`, `proxy-json`, `logout`, `agent-proxy`
et `bff-origin-contract` couvrent refus et compatibilité. Ils ne constituent pas
à eux seuls une preuve de déploiement ou un test navigateur d'une entrée LB.
Avant activation d'un domaine, vérifier les deux chemins d'accès effectivement
conservés (LB et éventuel `run.app`) et le choix d'origine de chacun ; aucune
liste globale `*.ynov.ma` n'est autorisée. Réception réelle d'un e-mail, WIF et
autorisation opérationnelle PROD restent des preuves distinctes.

Le test unitaire de compatibilité utilise le vrai `NextRequestAdapter` et un
`IncomingMessage` vide, avec et sans Content-Type. La recette navigateur vérifie
que des POST/DELETE sans corps et sans cookie atteignent le refus de session
`401`, sans appel API ; l'origine API loopback synthétique de la preview n'est
pas un serveur ni une dépendance métier.

## Retour arrière

Revert applicatif protégé, puis retour à l'origine/entrée de trafic précédemment
validée. Aucun changement de schéma, données, cookie ou profil natif n'est requis.
Ne pas activer le nouveau domaine après retrait du garde ; conserver ses réserves
dans le dossier de promotion. Aucun contournement automatique en cas de refus.
