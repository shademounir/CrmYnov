# Correction des informations d’un Lead

## Contrat

Le panneau « Modifier les informations » de la fiche et la page `/leads/{leadId}/edit` utilisent le même formulaire et le même endpoint `PATCH /leads/{leadId}`. Une interaction antérieure n’interdit pas une correction. Les règles particulières d’un dossier clôturé continuent d’être appliquées côté serveur.

Champs autorisés : prénom, nom, email, téléphone, campus, campagne, niveau d’études, formation et source. Tout autre champ est refusé. Un champ absent reste inchangé ; un email ou téléphone explicitement vide est effacé. Les champs obligatoires ne peuvent pas être vidés.

Le serveur normalise l’email et le téléphone. Il retire uniquement les séparateurs du téléphone et n’ajoute jamais de chiffre ni de préfixe. Une collision de contact retourne `409 lead_contact_collision` sans révéler l’autre Lead et sans fusion. Une version obsolète retourne `409 lead_version_conflict`.

## Persistance et audit

La modification s’exécute dans la transaction PostgreSQL canonique avec contrôle de version, validation des référentiels, reçu d’idempotence, audit `LEAD_UPDATED` et outbox. Un rejeu exact retourne le résultat mémorisé sans second audit. Toute erreur avant le commit annule la fiche, les activités, le reçu, l’audit et l’outbox.

L’identité du Lead, ses relations, ses provenances et tous les événements historiques sont conservés. La fiche affiche uniquement les valeurs courantes confirmées par le serveur.

## Recette synthétique

1. Ouvrir la fiche avec un Admin du campus et corriger un champ sans contact préalable.
2. Ajouter une interaction, puis corriger le nom : l’interaction reste dans l’historique.
3. Effacer explicitement une coordonnée facultative et vérifier la relecture après redémarrage.
4. Tenter un email ou téléphone invalide, une collision et une ancienne version : vérifier le message, la saisie conservée et l’absence d’audit de succès.
5. Rejouer exactement la requête : vérifier un seul audit et une seule augmentation de version.
6. Vérifier le refus hors campus et avec un rôle sans `lead.edit`.
