# CRMY-175 — Disponibilités et réservation Admissions

Statut : contrat de travail, implémentation non livrée. Décision utilisateur : agenda CRM et indisponibilités manuelles pour le premier lot. Calendrier externe, réservation publique, email/SMS et décision automatique d'admission exclus.

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

## Persistance et concurrence à réaliser

Migration additive : désignations responsables, fenêtres de disponibilité/indisponibilité et métadonnées de demande, sans réécriture des migrations appliquées. Réutiliser les rendez-vous et leurs événements plutôt que créer une deuxième activité métier pour la même décision.

Tous les écrivains concernés (réservation, décision, report, modification des fenêtres et rendez-vous hérités) doivent utiliser le même verrou transactionnel par participant, dans un ordre stable. Après acquisition : relecture PostgreSQL de la disponibilité et des occupations, contrôle de version, puis réservation/événement/audit/notification dans une transaction. Un contrôle mémoire ou un simple avertissement ne suffit pas. Tester deux connexions/processus concurrents sur PostgreSQL réel.

L'idempotence est liée à l'acteur, l'opération et la charge utile canonique. Même clé/même contenu : résultat d'origine ; même clé/contenu différent : conflit. Un rejeu ne crée pas une nouvelle activité, notification ou décision. Ne pas réutiliser une clé de décision pour une réservation.

Révocation : vérifier à chaque commande les autorisations effectives, l'activité du profil responsable et le campus. Ne pas considérer une désignation passée ou le cache du navigateur comme un droit courant.

## Vues à raccorder

1. Responsable : agenda personnel, déclaration des fenêtres, blocages privés, demandes reçues, accepter/refuser et motif.
2. Commercial : depuis le Lead, responsable autorisé et créneaux disponibles uniquement ; demande envoyée, statut distinct de la confirmation.
3. Fiche et liste : même résultat après actualisation, refus/conflits honnêtes, saisies conservées et double soumission protégée.

Recette : comptes synthétiques activés, campus isolé, preuve UI → API → PostgreSQL, cas de concurrence/rejeu/révocation, responsive 1280/820/390. Les validations anciennes ne couvrent pas ce nouveau parcours. Aucun changement de données DEV ni nouvelle notification réelle à ce stade.
