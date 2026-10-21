# Préparation des rappels métier internes — non activée

Ce socle pur prépare des messages sur des faits fournis par le serveur. Il ne constitue
pas une autorisation, un journal durable, un worker ou un envoi Gmail. Aucun module
Nest, job, outbox existante, invitation, variable PROD ou migration ne le référence.
`PREPARED` signifie uniquement « modèle et sélection préparés », jamais « envoyé ».

## Sélection et contenu

Les cinq modèles français couvrent relance due, avertissement de retard, premier
traitement strictement après 24 h, confirmation attendue et retour de rendez-vous
attendu. Les messages ne contiennent que la référence courte, l’action attendue,
l’échéance Casablanca, le retard observé et l’entrée CRM nécessitant authentification.
Ils n’incluent ni coordonnées prospect, ni nom privé, ni compte rendu, ni jeton.

Le premier traitement conserve la réception persistée, exclut BASELINE, les dates
inconnues et les dossiers déjà traités. Une échéance de confirmation doit déjà exister ;
elle n’est jamais inventée. Un retour suppose réservation ACCEPTED et rendez-vous
CONFIRME arrivé à son terme. Cela ne produit aucun statut de réalisation ou d’absence.

Le destinataire est le propriétaire persistant de l’action ou le responsable Admissions
désigné, résolu par le futur adaptateur serveur. Une réaffectation du Lead ne suffit
pas à remplacer ce propriétaire. To et Cc exigent activité, accès effectif au Lead et
appartenance explicite au couple campus/campagne. Une appartenance au seul campus
ne vaut pas participation à toutes ses campagnes ; un candidat de pool n’est pas une
appartenance d’équipe. Pas de repli vers l’adresse du prospect ou tout le campus.
Les identités/adresses ambiguës sont retenues plutôt que fusionnées silencieusement.

La préparation est OFF sans décision et borne d’activation explicites. Les échéances
antérieures à cette borne sont retenues : une vague historique nécessite un objectif
séparé et borné. Le premier avertissement n’est éligible qu’après une cadence complète,
afin de ne pas doubler immédiatement le rappel d’échéance. Les occurrences suivantes
sont ancrées à l’échéance, avec plafond, jamais au démarrage du worker. La clé stable
ne change pas lors d’un déploiement de modèle ou d’une modification des copies.
Cela n’assure pas la déduplication sans stockage transactionnel.

## Conditions restant requises avant tout branchement et activation

- Appartenances CRM campus/campagne explicites, réellement administrées et auditées.
- Lecture serveur des propriétaires, désignations, autorisations, états et échéances ;
  revalidation sous les verrous/fences adaptés juste avant l’émission, pas des booléens
  venant d’une requête client ni un instantané ancien.
- Journal durable à unicité événement/échéance/occurrence ; conserver version et
  empreinte du contenu, destinataires autorisés, état et identifiant transport.
- Barrière SENDING durable avant l’appel irréversible ; après timeout, crash, réponse
  ambiguë ou acceptation suivie d’un échec de commit : UNCERTAIN, jamais renvoi automatique.
  Aucun ajout direct du handler Gmail au retry générique de LocalOutboxWorker.
- Estimation fraîche des volumes autorisés par type/campus/campagne et des destinataires
  manquants, plafond global de vague et cadence. Aucun volume PROD n’est estimé ici.
- Fixtures PostgreSQL concurrentes réelles, crash avant/après SENDING, replay, clôture
  et révocation concurrentes, faute de commit et tests de transport vers compte autorisé.
- Conserver le transport Gmail configuré sans modifier/rejouer invitation ou récupération.
  Distinguer acceptation transport, réception et lecture humaine.
- Qualification complète du lot, gouvernance et recette officielle avant activation.

Ces fonctions pures et leurs tests ne satisfont pas ces conditions restantes. Ni le
rendez-vous réel du 21 octobre, ni sa préparation, ni les données PROD ne sont modifiés.
