# Rappels métier internes — activation contrôlée, non livrée à ce stade

Ce lot implémente un worker externe séparé sur des faits relus par le serveur,
une configuration durable et des appartenances explicites campus/campagne. Il
n'est ni activé ni réputé livré tant que les gates et la recette réelle ne sont
pas terminés. Un transport Gmail séparé est testé
hors réseau : To/Cc validés, MIME français texte/HTML, délai total de 15 secondes,
zéro retry OAuth/POST, erreurs privées masquées et identifiant fournisseur requis.
Il ne résout pas les droits et exige en amont les fences métier et un SENDING commis.
Il ne fournit aucune garantie d'appartenance à partir d'une adresse : l'adaptateur
serveur établit les destinataires internes depuis les comptes CRM activés et
leurs permissions/plafonds effectifs, sous les verrous adaptés.
Aucun module Nest, outbox existante ou chemin d'invitation ne le référence. Le
nouveau point d'entrée `jobs/business-mail` n'altère pas le job RC36.
`PREPARED` signifie uniquement « modèle et sélection préparés », jamais « envoyé ».

Un journal séparé et sa migration additive sont préparés localement, sans déploiement.
Le client racine dédié attend le commit d’une réservation unique `SENDING` avant de
retourner son token. Les passages suivants, y compris après interruption du processus,
ne reçoivent aucun nouveau token. Les terminaisons sont `ACCEPTED` (acceptation du
transport seulement) ou `UNCERTAIN`. Une ancienne réservation interrompue devient
`UNCERTAIN`, pas une tâche à réémettre. Métadonnées, états terminaux, DELETE et TRUNCATE
sont protégés par les contraintes/triggers. Le journal n’implémente ni l’autorisation
ni les verrous du dossier. Son empreinte lie
le contenu rendu, les destinataires ordonnés et le périmètre effectivement autorisé.
Une panne avant le commit de réservation ne permet aucun appel fournisseur ; après
commit, une panne reste conservativement incertaine même si aucun appel n’a eu lieu.
Le JSON immuable `recipient_user_ids` conserve désormais des tuples versionnés,
ordonnés : version, identifiant CRM, adresse historique, To/Cc, campus et campagne.
Le nom SQL historique et les quatorze colonnes protégées restent inchangés. Le
fingerprint lie aussi les faits rendus et le contenu exact du modèle. Ce format
évite toute dépendance à l'ordre des clés d'objet JSONB ; aucun ancien journal
PROD n'est converti (cette migration n'y est pas encore déployée).

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
désigné, résolu par l'adaptateur serveur. Une réaffectation du Lead ne suffit
pas à remplacer ce propriétaire. To exige activité, droit effectif sur cette action,
responsabilité persistée du type attendu et périmètre campus/campagne exact. Cette
projection serveur est distincte de la liste des copies : le responsable réel peut
ne pas appartenir à cette liste. Cc exige activité, accès effectif au Lead et
appartenance explicite au couple campus/campagne. Une appartenance au seul campus
ne vaut pas participation à toutes ses campagnes ; un candidat de pool n’est pas une
appartenance d’équipe. Pas de repli vers l’adresse du prospect ou tout le campus.
Les identités/adresses ambiguës sont retenues plutôt que fusionnées silencieusement.
Un compte sélectionné dans une appartenance peut encore être en premier accès :
cela ne l'active pas et ne lui accorde aucun droit. Il reste exclu de tous les To/Cc
tant que son accès officiel n'est pas achevé. Le préflight distingue ces états des
volumes de destinataires effectivement autorisés sur chaque dossier.

La préparation est OFF sans décision et borne d’activation explicites. Les échéances
antérieures à cette borne sont retenues : une vague historique nécessite un objectif
séparé et borné. Le premier avertissement n’est éligible qu’après une cadence complète,
afin de ne pas doubler immédiatement le rappel d’échéance. Les occurrences suivantes
sont ancrées à l’échéance, avec plafond, jamais au démarrage du worker. La clé stable
ne change pas lors d’un déploiement de modèle ou d’une modification des copies.
Cela n’assure pas la déduplication sans stockage transactionnel.
La réservation du journal sérialise désormais les nouveaux événements sous un
verrou PostgreSQL global dédié. Elle compte les réservations de toutes les issues
dans des fenêtres UTC heure/jour fixes, en messages et destinataires ; aucune remise
à zéro lors d'un redémarrage ou d'une désactivation. Vérification des plafonds et
INSERT SENDING commis sont atomiques. Un rejeu du même événement ne débite pas
de nouveau budget. Un avertissement exige aussi une cadence minimale depuis la
dernière tentative commise du même rappel (y compris incertaine).
Les plafonds effectifs doivent encore venir d'une configuration durable contrôlée,
avec estimation fraîche du volume avant activation ; les valeurs des tests ne
constituent pas une décision de volume PROD.

## Branchement et barrières d'activation

Le worker maintient le verrou partagé de permissions et les verrous métier
(tâche puis Lead partagé, ou participants/rendez-vous puis Lead partagé). Chaque
émission utilise un délai de 20 secondes inférieur à la transaction de 30 secondes,
transport compris (15 secondes maximum). Les révocations prennent le verrou
exclusif. Les clôtures attendent le verrou partagé du Lead. Le journal racine ne
reprend jamais un verrou extérieur, ce qui évite un interblocage de commit.

La découverte et le préflight sont bornés : un dépassement de 10000 lignes par
famille échoue explicitement, sans tronquer silencieusement une file. La réception
et les compensations de traitement réutilisent les projections CRM canoniques.
Le contrat actuel des réservations n'a pas d'échéance de confirmation persistée :
ces confirmations sont comptées comme retenues et aucune date n'est inventée.

Le job opérateur est un outillage délégué, pas une session HTTP fabriquée. Il
exige la cible base/environnement/projet exacte, le SHA source qualifié et le grant
`crm-ynov-po-delegation-20261001`. Il vérifie le véritable compte d'autorité Super
Admin et ses permissions globales et campus. L'audit nomme l'exécutant système
Codex, séparément de ce compte d'autorité ; il ne revendique aucune action ou
acceptation personnelle PO. Chaque paire d'appartenance créée possède son audit.

Ordre opérateur, sous objectif qualifié et identifiants d'opération uniques :

1. `PREPARE` : configuration OFF et seules appartenances explicitement autorisées,
   sans modification d'affectation, rôle, secret, session ou invitation.
2. `FIXTURE` : un message synthétique explicitement TEST, au seul compte Super
   Admin d'autorité autorisé ; clé durable unique et zéro renvoi si incertain.
   ACCEPTED prouve uniquement l'acceptation du transport Gmail.
3. `PREFLIGHT` : estimation native fraîche par type et scope, destinataires,
   historiques exclus et états du roster ; source, version et empreinte des
   réglages sont liés au résultat durable.
4. `ACTIVATE` : refuse sans fixture ACCEPTED, préflight de moins de cinq minutes
   lié à la même version/source/réglages et volume compatible avec les quatre
   plafonds. La première activation fixe l'heure serveur. `PAUSE` la conserve ;
   un redémarrage ne la remplace jamais. Un historique dépassant la vague bornée
   nécessite un objectif séparé, pas une remise à zéro.
5. Activer seulement le nouveau job/Scheduler après recette et contrôles natifs.
   `CRM_BACKGROUND_WORKERS=external` et la qualification sont obligatoires ; le
   flag d'envoi OFF retourne avant SQL/OAuth. Ne pas retoucher RC36 ni ses révisions.

L'opérateur ne supprime/désactive pas silencieusement d'anciennes appartenances
hors de l'objectif. Les révisions de configuration sont optimistes et chaque
mutation est auditée/idempotente. Une issue inconnue exige lecture du reçu avant
toute reprise ; le code ne relance jamais automatiquement un envoi.

## Conditions restant requises avant livraison réelle

- Publier les appartenances CRM campus/campagne explicitement approuvées sous
  l'objectif déployé, après revalidation des comptes et références actuels.
- Lecture serveur des propriétaires, désignations, autorisations, états et échéances ;
  revalidation sous les verrous/fences adaptés juste avant l’émission, pas des booléens
  venant d’une requête client ni un instantané ancien.
- Intégrer le journal durable à unicité événement/échéance/occurrence ; conserver version et
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

Le code et ses tests locaux ne satisfont pas à eux seuls ces conditions restantes. Ni le
rendez-vous réel du 21 octobre, ni sa préparation, ni les données PROD ne sont modifiés.
