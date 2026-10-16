# Suivi commercial et validation des étapes

Le 16 octobre 2026, le PO a demandé de prioriser le suivi commercial avant l’activation Sheets : commentaires visibles, prochaine action facultative, qualification accessible aux commerciaux sur leurs dossiers, validation distincte des étapes et transmission au Manager Imane Hannoud. Il a également demandé des sélecteurs de conseillers et collaborateurs existants dans les filtres Leads.

## Droits et circuit

- `lead.qualification.update` : par défaut OWN pour ADMISSIONS, CAMPUS pour MANAGER/ADMIN, GLOBAL pour SUPER_ADMIN. Les refus et restrictions explicitement enregistrés restent prioritaires ; aucune configuration historique n’est réécrite au démarrage.
- La température reste distincte de l’étape commerciale.
- Le commercial propose Prospect, Contacté ou Qualifié avec un motif. La proposition est conservée dans le registre existant des demandes, sous le motif `COMMERCIAL_STAGE_REVIEW`, et ne modifie pas le Lead.
- Un superviseur autorisé, distinct du demandeur, décide. Les décisions restent versionnées et protégées contre la double validation.
- Les notifications sont créées dans la même transaction que la demande, pour les responsables activés du campus dont les permissions permettent `lead.view` et `lead.close.approve`. Les destinataires sont résolus depuis les comptes existants ; aucune identité ou adresse n’est codée en dur.
- La liste expose `canDecide` après vérification serveur. Le commercial et le demandeur voient uniquement l’état de leur demande ; le menu Validations est réservé aux rôles de supervision.
- Les anciennes demandes en attente peuvent faire l’objet d’une réconciliation explicite et idempotente des notifications depuis Validations. Elle conserve demandes, statuts et décisions.

## Interactions et filtres

Le commentaire d’interaction est affiché comme texte dans la timeline de la fiche et dans l’historique détaillé. La prochaine action est facultative ; une date fournie doit rester valide et future. L’absence de nouvelle date conserve l’échéance déjà enregistrée.

Les filtres Conseiller principal et Collaborateur transmettent les identifiants réels sélectionnés dans une liste de noms issue du périmètre de dossiers autorisé. Les noms dans l’URL servent uniquement à l’affichage des filtres, jamais à l’autorisation serveur.

## Livraison et retour arrière

Aucune migration n’est requise : les cibles commerciales utilisent la colonne texte déjà présente du registre de demandes. Le déploiement doit vérifier les permissions persistées réelles, la notification destinée à Imane, les vues commerciale et superviseur et les filtres en PROD.

Le retour arrière consiste à rétablir les images compatibles après sauvegarde. Les demandes commerciales déjà enregistrées sont conservées et leurs décisions suspendues sur une ancienne version ne comprenant pas ces cibles. Ne pas restaurer globalement la base, rejouer l’import historique ou réémettre les invitations. Sheets, sa frontière N0=2586 et ses reçus restent indépendants de ce lot métier.

## Disponibilité des collections et permissions

La recette RC27 sur le portefeuille de 2 398 Leads a exposé des réponses 503 et des lectures longues. L’ancien calcul des collections répétait les lectures Lead, campus, conseiller et responsabilité pour chaque dossier, tout en conservant la transaction d’autorisation. Une seconde instance a également échoué au démarrage dans le magasin de permissions. Ne pas attribuer toutes les erreurs à une seule cause sans relecture des journaux et recette du correctif en PROD.

Le correctif de lecture groupée conserve le même filtre campus, les mêmes contextes et évaluations de droits, les plafonds explicites, les verrous PostgreSQL, délais et modes de transaction. La projection Lead/collaborateurs est lue une fois ; les campus, conseillers et responsabilités identiques sont relus une fois par transaction. Aucun cache ne survit à cette transaction ou n’est partagé entre identités. La transmission des demandes réutilise seulement les contextes de cette même transaction.

Les preuves synthétiques comparent les anciens/nouveaux contextes pour Super Admin, Manager, Commercial et Lecteur, vérifient le budget de lectures sur 2 398 dossiers et exercent deux API PostgreSQL avec filtres concurrents, totaux avant pagination et révocation. Elles ne prouvent ni la latence PROD ni la lecture personnelle d’une notification par Imane. Après release protégée, recontrôler les filtres, les demandes et les journaux PROD avant activation Sheets.
