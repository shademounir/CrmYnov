# Qualification commerciale manuelle

## Contrat

La température est indépendante du statut commercial, des documents et du résultat de contact. Les valeurs exposées sont `UNEVALUATED` (Non évalué), `COLD` (Froid), `WARM` (Tiède) et `HOT` (Chaud). Seules les trois dernières peuvent être enregistrées : `UNEVALUATED` est la projection d’un Lead sans qualification humaine.

Chaque modification ajoute une ligne à `lead_commercial_qualifications` avec auteur, date, motif, commentaire facultatif et version. Elle ne modifie pas la ligne `leads`. L’audit `LEAD_QUALIFICATION_UPDATED` est créé dans la même transaction PostgreSQL.

## Autorisation

La lecture réutilise `lead.view`. La modification exige `lead.qualification.update`. Le registre v2 l’attribue par défaut au Super Admin en `GLOBAL` et à l’Admin en `CAMPUS`; les autres rôles restent inchangés et l’Auditeur ne peut jamais recevoir ce droit de mutation. Le contrôle dynamique réévalue le rôle, les plafonds GLOBAL/CAMPUS et le campus du Lead à chaque requête.

Une configuration persistée avec l’ancien catalogue est complétée au démarrage dans une nouvelle version append-only : plafonds et Super Admin reçoivent la portée applicable, l’Admin reçoit `CAMPUS`, les autres rôles `NONE`. Une seule instance réalise l’évolution sous le fence PostgreSQL ; l’audit `CATALOGUE_UPGRADE` conserve l’avant/après. Aucun reset de grants ni autorisation des capacités futures n’est effectué.

## Appels

- `GET /leads/{leadId}/qualification` retourne `current` et `history`. Un Lead jamais qualifié retourne `UNEVALUATED`, version 0 et un historique vide.
- `PATCH /leads/{leadId}/qualification` exige `temperature`, `reason`, `expectedVersion` et `idempotencyKey`; `comment` est facultatif.
- Une version attendue périmée retourne 409 sans écriture.
- Le rejeu exact d’une clé retourne la version déjà créée sans nouvel audit.
- La même clé avec un autre contenu ou un autre Lead retourne 409.

## Preuves de recette

1. Vérifier le droit effectif Admin ou Super Admin dans le campus du Lead, puis vérifier séparément le refus d’un rôle sans grant.
2. Ouvrir une fiche Lead et vérifier « Non évalué » avant toute saisie.
3. Ouvrir « Qualifier », choisir une température, saisir un motif conforme et enregistrer.
4. Vérifier le libellé sur la fiche, dans la liste, l’historique des qualifications et le KPI de répartition.
5. Depuis une seconde session, tenter une modification avec l’ancienne version : le serveur doit répondre 409 et conserver la première valeur.
6. Vérifier qu’un compte hors campus ou Auditeur reçoit 403 et qu’aucun historique ni audit supplémentaire n’est créé.

Les tests automatisés PostgreSQL valident les defaults Admin/Super Admin, le refus intercampus, l’évolution versionnée d’une ancienne configuration et la révocation visible depuis une seconde instance.

## Désactivation

Retirer le grant `lead.qualification.update` des configurations concernées. Les lectures et l’historique restent disponibles selon `lead.view`. Ne supprimer ni réécrire les lignes de qualification ou les audits existants.
