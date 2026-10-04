# CRMY-175 — Disponibilités et réservation Admissions

Statut : implémentation candidate du 3 octobre 2026, livraison conditionnée aux contrôles du SHA publié et à la recette du build DEV déployé. Décision utilisateur : agenda CRM et indisponibilités manuelles pour le premier lot. Calendrier externe, réservation publique, email/SMS et décision automatique d'admission exclus.

## Écart constaté sur develop 95a963800b68671b0801d9700e086f47a0086991

Le service Rendez-vous expose les plages occupées, pas les disponibilités déclarées. La création sélectionne actuellement le conseiller affecté ou le demandeur et produit un rendez-vous PLANIFIE. Le conflit est un avertissement ; ce comportement ne prouve pas une réservation concurrente exclusive ni une acceptation par le responsable.

Le rôle technique ADMISSIONS désigne actuellement le Commercial. Il ne faut ni le renommer globalement ni conférer les droits Manager à un responsable. Le responsable doit être un utilisateur actif explicitement désigné pour un campus, avec autorisations bornées à son agenda et à ses demandes.

## Contrat de réservation

- Disponibilités : fenêtres explicites, dates absolues UTC ; restitution Africa/Casablanca sans offset fixe. Pas de récurrence nécessaire au premier lot.
- Indisponibilités : fenêtres manuelles privées. Le Commercial reçoit uniquement les créneaux libres, pas les intitulés ou motifs des engagements.
- Créneau : intervalle semi-ouvert `[début, fin)` contenu dans une disponibilité, durée conforme au contrat Rendez-vous, début futur et campus du Lead autorisé.
- Une demande réserve le créneau. L'acceptation est une décision distincte, effectuée par le responsable désigné ; le demandeur ne s'auto-approuve pas. Pas d'acceptation tacite après un délai.
- Un refus ou une annulation libère la réservation. Un report réserve atomiquement le nouveau créneau et libère l'ancien, sans perdre l'ancien en cas d'échec.
- Les rendez-vous existants non terminaux constituent aussi des occupations. Aucun backfill de décision, de responsable ou de disponibilité implicite.
- Les participants communs doivent également être protégés contre les chevauchements.

## Exigences de persistance et de concurrence

Migration additive : désignations responsables, fenêtres de disponibilité/indisponibilité et métadonnées de demande, sans réécriture des migrations appliquées. Réutiliser les rendez-vous et leurs événements plutôt que créer une deuxième activité métier pour la même décision.

Tous les écrivains concernés (réservation, décision, report, modification des fenêtres et rendez-vous hérités) doivent utiliser le même verrou transactionnel par participant, dans un ordre stable. Après acquisition : relecture PostgreSQL de la disponibilité et des occupations, contrôle de version, puis réservation/événement/audit/notification dans une transaction. Un contrôle mémoire ou un simple avertissement ne suffit pas. Tester deux connexions/processus concurrents sur PostgreSQL réel.

L'idempotence est liée à l'acteur, l'opération et la charge utile canonique. Même clé/même contenu : résultat d'origine ; même clé/contenu différent : conflit. Un rejeu ne crée pas une nouvelle activité, notification ou décision. Ne pas réutiliser une clé de décision pour une réservation.

Révocation : vérifier à chaque commande les autorisations effectives, l'activité du profil responsable et le campus. Ne pas considérer une désignation passée ou le cache du navigateur comme un droit courant.

## Vues du parcours

1. Responsable : agenda personnel, déclaration des fenêtres, blocages privés, demandes reçues, accepter/refuser et motif.
2. Commercial : depuis le Lead, responsable autorisé et créneaux disponibles uniquement ; demande envoyée, statut distinct de la confirmation.
3. Fiche et liste : même résultat après actualisation, refus/conflits honnêtes, saisies conservées et double soumission protégée.

Recette : comptes synthétiques activés, campus isolé, preuve UI → API → PostgreSQL, cas de concurrence/rejeu/révocation, responsive 1280/820/390. Les validations anciennes ne couvrent pas ce nouveau parcours. Aucun changement de données DEV ni nouvelle notification réelle à ce stade.

## Implémentation du lot — 3 octobre 2026

L'implémentation courante est PostgreSQL uniquement, protégée par la transaction d'autorisation persistée commune (`DynamicPermissionRepository`, session/activité/grants actualisés). Elle ajoute quatre tables vides via `20261003120000_admissions_booking`, sans changer les migrations déjà appliquées, les données historiques ou l'historique Prisma. Le responsable est une désignation active et versionnée par utilisateur/campus canonique ; `ADMISSIONS` conserve son sens Commercial. L'administration nécessite `settings.campus.manage`, l'usage effectif `appointment.manage`, et la réservation ajoute `lead.view` sur la vraie ressource. Aucune attribution implicite de droits ou de collaboration Lead.

Endpoints raccordés à `/docs-json` :

- `GET /admissions/context` : capacités effectives, propres désignations, campus et utilisateurs éligibles bornés.
- `GET/POST /admissions/responsibles` : responsables actifs pour le Lead ; administration versionnée des désignations/révocations dans un campus autorisé. La liste d'administration inclut les désignations inactives afin de ne pas perdre leur version.
- `GET/POST /admissions/windows`, `PATCH /admissions/windows/:id` : fenêtres `AVAILABLE` et blocages `BLOCKED` privés, retrait optimiste. Une disponibilité occupée ne peut être retirée sans une autre fenêtre couvrant toujours les demandes actives.
- `GET /admissions/slots` : créneaux libres uniquement, plage de recherche de sept jours maximum, pas de détail des occupations. Les engagements des participants et les blocages manuels sont pris en compte. `bookingId` permet uniquement un report borné et exclut sa propre réservation.
- `POST /leads/:leadId/admissions-bookings` : demande `PENDING`, rendez-vous `PLANIFIE` provisoire et réservation exclusive. Un reçu immuable lie acteur/opération/clé/charge canonique ; un rejeu rend le résultat initial, pas un état courant inventé.
- `GET /admissions/bookings`, `GET /admissions/bookings/:id`, `GET /admissions/bookings/:id/slots` : demandes reçues/émises bornées et détail minimal. Campus et audience effective sont préfiltrés en SQL avant pagination, puis les droits ressource sont revérifiés. `limit` vaut 50 par défaut, maximum 100 ; tri stable date/id, `hasMore` et `nextCursor` opaque. Un scan d'autorisation borné peut restituer moins de résultats tout en annonçant explicitement une suite. Après report, recharger l'agenda. Le responsable n'obtient pas ainsi un accès général à la fiche Lead.
- `PATCH /admissions/bookings/:id` : `ACCEPT`, `REFUSE`, `CANCEL`, `RESCHEDULE`. La décision exige un acteur distinct du demandeur, responsable désigné ou Admin explicitement autorisé. Le report réserve le nouveau créneau atomiquement et revient à `PENDING`/`REPORTE`. Une annulation autorisée peut libérer une demande même après révocation de la désignation.
- Le même endpoint trace `COMPLETE`/`NO_SHOW` après la fin prévue uniquement ; il ne crée aucune renumérotation, relance ou nouvelle réservation automatique. L'acceptation de la demande reste conservée et l'état rendez-vous devient `REALISE` ou `ABSENT`.
- `POST /admissions/bookings/:id/report` : compte-rendu d'entretien après `REALISE`, par le responsable évaluateur distinct du demandeur. Résultat manuel, texte conservé expurgé selon le contrat InterviewReport existant, reçu/rejeu contrôlés, aucun statut Lead d'admission automatique.

La liste Rendez-vous expose `admissionsBookingState` et `admissionsResponsibilityId` pour une navigation honnête vers le détail contrôlé. Les événements, l'activité Lead, l'audit, la notification interne par destinataire et le reçu sont atomiques. Aucun Gmail, SMS, calendrier externe, Sheets ou PBX n'est utilisé.

Les écrivains legacy partagent les mêmes verrous PostgreSQL par participant, ordonnés puis relisent les occupations et blocages. Une nouvelle création legacy ciblant un conseiller désigné Admissions est refusée avec `admissions_controlled_booking_required` ; elle ne peut contourner les disponibilités et la décision. Les transitions et comptes-rendus legacy sur les nouvelles métadonnées sont aussi refusés au profit des endpoints contrôlés. Les anciens rendez-vous restent inchangés et ne reçoivent pas de décision backfillée.

Le rollback est **conditionnel** : conserver l'API contrôlée si des demandes Admissions sont actives. Ne pas revenir aveuglément à une API ancienne ignorant leurs métadonnées ; conserver tables, événements, reçus et historique Prisma. Voir le document de rollback de la migration.

Les occupations sont filtrées par chevauchement UTC exact dans PostgreSQL, sans troncature des occupations susceptible d'inventer des créneaux libres. Les campus et profils d'agenda sont restreints en SQL ; les instantanés de droits et campus sont mémorisés uniquement dans leur transaction clôturée, jamais comme droits conservés entre requêtes.

Preuves locales déjà acquises sur la base synthétique isolée à nonce : 11 contrôles PostgreSQL de concurrence/rejeu/révocation/isolation/visibilité (dont 402 demandes étrangères ou d'autres acteurs ne masquant pas la demande autorisée), 7 parcours de persistance/pagination, 7 tests unitaires de validation/slots/contrat et un parcours réel Nest HTTP → API → PostgreSQL (demande, décision distincte, refus, actualisation et rejeu sans effet supplémentaire). Les tests d'issue après fin utilisent une horloge contrôlée uniquement dans le processus de test ; ils ne prouvent pas une observation réelle d'un rendez-vous. Ces résultats ne valent pas encore gates distants sur un SHA publié ni acceptation esthétique personnelle.

Le test HTTP sur cette base peuplée a révélé un recalcul legacy quadratique des avertissements, avec formats de date répétés même pour les rendez-vous annulés. Le recalcul utilise désormais les index actifs par participant/jour et un formateur unique ; les terminaux ne contribuent pas à la charge. Le refus d'une transition legacy contrôlée intervient avant toute mutation mémoire ou queue de notification, avec garde SQL finale conservée. Sur la même base sans effacer les fixtures, le `PATCH /appointments/:id/state` qui dépassait dix secondes a ensuite répondu `409` en 109 ms ; le parcours HTTP complet est passé en 2,25 s lors de son contrôle isolé. La non-régression compare huit puis sept rendez-vous actifs face à 300 historiques annulés. Les fichiers d'intégration partageant l'epoch globale sont séquencés dans le harness ; les courses métier à deux connexions demeurent explicitement concurrentes dans leur test.
