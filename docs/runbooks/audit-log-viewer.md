# CRMY-54 — consultation persistante du journal

Écran `/admin/audit`, API GET `/audit-events` et `/audit-events/:id`.
UI Ynov V2, cartes responsive, clavier, focus visible, cibles 44 px,
dialogue natif et états chargement/vide/refus/erreur. Aucun export ni mutation
d'événement. Le chemin normal lit `audit_events` dans PostgreSQL via l'API.

## Arbitrage PO du 3 septembre 2026

SUPER_ADMIN, ADMIN ou AUDITOR obligatoire **et** `audit.view` effectif.
MANAGER/ADMISSIONS seuls refusés même si une configuration historique les
autorise ; leurs defaults deviennent NONE sans réécriture des versions.
Les seuls rôles admissibles contribuent à la lecture. Les grants admissibles
non-NONE sont intersectés : un grant CAMPUS ne peut être élargi par un autre
grant GLOBAL dans un cumul. Les plafonds global/campus et refus de ressource
restent obligatoires. Un rôle sans grant ne crée aucun droit. Aucun autre
calcul de permission n'est changé, AUDITOR reste non mutatif.

Les bornes de campus sont résolues serveur avant total/pagination. URL et
payload ne peuvent élargir les résultats. Les événements anciens sans campus
structuré restent GLOBAL-only : aucune déduction du campus actuel de l'acteur,
aucun backfill d'historique. Les nouveaux audits Lead capturent leur campus
au moment de la mutation. Ce lot ne prétend pas convertir les producteurs
historiques en mémoire ni importer leurs événements perdus dans PostgreSQL.

## Contrat et minimisation

Filtres exacts : actorId, resourceId/lead UUID, resourceType, eventType, result,
campus UUID autorisé, from/to UTC RFC3339 Z. L'UI explicite UTC à la saisie et
affiche les événements dans Africa/Casablanca. Tri occurredAt DESC/id DESC,
page 1–10000, pageSize 1–100 ; snapshot conservé pendant la pagination.
Une recherche/détail réussi ajoute AUDIT_SEARCHED/AUDIT_VIEWED avant réponse.
Si cet append échoue, la lecture échoue ; aucun filtre textuel libre ni
secret n'est journalisé. Une erreur ne modifie aucun événement antérieur.

Réponse en liste autorisée : ID technique, type, rôle, ressource/campus, date,
résultat et quelques métadonnées booléennes/entières (version, active, count…).
Jamais session, hash, token, IP, correlationId ou contenu avant/après arbitraire.
Un détail absent/hors périmètre renvoie le même 404. Une panne de résolution
des grants n'utilise pas de fournisseur permissif de secours.

## Tests et rollback

Tests purs, API, PostgreSQL tmpfs et navigateur exclusivement synthétiques.
Une migration additive ajoute trois colonnes nullable et deux indexes ;
aucune migration de données. Validation uniquement sur base éphémère neuve.
Rollback applicatif : arrêter l'exposition du nouveau lecteur, conserver les
colonnes et tous les événements. Aucune suppression/édition d'audit ni volume.
Les activations cloud, bases distantes, données réelles et secrets restent gelés.
