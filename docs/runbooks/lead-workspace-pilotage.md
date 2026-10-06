# CRMY-163 / CRMY-178 — poste Leads et pilotage configurable

La livraison combine deux périmètres traçables : CRMY-163 pour le poste Leads,
CRMY-178 pour l'accès au pilotage et la présentation du centre des rôles. Le
dashboard CRMY-162 déjà accepté n'est pas recréé. Ses calculs restent serveur.

## Poste Leads

Les files Tous, Mes leads, À relancer, Non affectés, Sans activité et Clôturés
conservent le contrat API. Les provenances connues restent visibles. La file
Imports en erreur est explicitement indisponible : la requête historique ne
reconstitue pas ce compteur, qui ne doit pas être présenté comme zéro.

Recherche, filtres, chips, tri, direction, pagination, taille de page et contexte
de retour sont conservés dans l'URL. Une modification de filtre retourne à la
première page. Le total provient du serveur, jamais du nombre de lignes reçues.
Une vue partagée est un contexte en lecture seule : les filtres ignorés par le
serveur ne sont pas proposés comme applicables ; une sortie explicite permet
de retrouver la liste normale. Le contrat des définitions sauvegardées n'est
pas élargi et la taille de page déjà supportée est correctement restituée.

Les lignes présentent les libellés réellement reçus du conseiller, du campus,
de la formation et de la source, ainsi que les dates disponibles. Les valeurs
absentes restent neutres ; un UUID n'est pas transformé en nom de collaborateur.
Chargement, vide, session expirée, accès refusé et API indisponible sont distincts.
La création de Lead n'apparaît qu'après confirmation de sa capacité serveur.

## Pilotage et centre de configuration

Le tableau de bord complet exige les trois permissions `reporting.view`,
`reporting.pilotage.view` et `lead.view` sur la même ressource. La capacité
`reporting.export` reste indépendante. Le serveur relit l'identité, les grants
et les relations actives sous la même garde de permissions à chaque lecture.
Les liens complets précisent `view=global` ; les liens personnels précisent
`view=personal`. Ici « global » désigne le mode de rapport, pas un droit global.

Manager/Admin conservent leur accès campus historique. Commercial et Lecteur
n'obtiennent aucun nouveau droit par défaut. Une désignation pour l'agenda
Admissions ne signifie pas que le compte est directeur : la direction utilise
le rôle autorisé ou une configuration de pilotage explicitement examinée.

La configuration porte sur **un rôle et un campus**, pas sur une exception
individuelle. Une configuration de rôle GLOBAL sert aussi de valeur héritée
pour les campus sans version spécifique. Examiner le nombre d'utilisateurs,
les plafonds, le motif, les changements et la prévisualisation avant d'appliquer.
Consulter les KPI ne donne aucun pouvoir d'administration ou d'approbation des
clôtures et réaffectations. Les parcours de décision gardent leurs contrats.

L'écran distingue la version enregistrée, le brouillon local, sa revue et
l'historique immuable. L'explication des droits concerne le compte connecté,
pas le rôle sélectionné ni le brouillon. Les réponses obsolètes sont écartées
après un changement de cible ou de contexte. Aucun échec n'active de fallback.

## Vérifications et limites

Les tests unitaires et DOM ne constituent pas une validation visuelle. Vérifier
la liste et le centre des rôles à 1440, 1280, 1024, 768 et 390 pixels sur le build
identifié, ainsi que le clavier, le focus, les états et les refus API réels.
Les simulations navigateur de CI sont distinctes des tests PostgreSQL et de la
recette connectée. Consigner leurs SHA et résultats séparément dans l'audit PR.

L'évolution du catalogue v4 ajoute une version et un audit, sans modifier les
versions antérieures. Le redémarrage est idempotent. Un `NONE` explicite v4 reste
révoqué ; une restauration volontaire et confirmée peut réattribuer des droits
historiques. Il n'y a aucune migration SQL nouvelle dans ce lot.

## Retour arrière

Conserver les versions, audits et données. En incident d'autorisation, refuser
les accès concernés et appliquer un correctif compatible en avant. Ne pas
réactiver une API ancienne dont les contrôles de rôle ignorent le nouveau droit
de pilotage : cela pourrait annuler une révocation. Un retrait de la nouvelle
présentation Web seul reste possible avec une API compatible et ses contrôles
actifs. Aucun reset, suppression d'historique ou retour au fournisseur statique.

Sheets, réception téléphonique, enregistrement audio, appels réels, campagnes
mail et passage PROD sont exclus de cette préparation. Aucun droit du compte
professionnel n'est modifié pour faciliter les tests.
