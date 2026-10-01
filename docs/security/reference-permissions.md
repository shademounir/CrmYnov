# CRMY-44 — droits des référentiels et des tags

Décision PO enregistrée dans CRMY-44 (commentaire 11992). CRMY-169 porte la
configuration dynamique future : elle reste To Do, sans démarrage. Ce document
de sécurité fait partie du périmètre à relire en manual-po ; aucune preuve PO
n'est produite par l'agent.

## Registre fermé et fournisseur remplaçable

`PermissionService.can/assertCan` consulte `GrantProvider`. `DefaultGrantProvider`
est le seul fournisseur livré. Pas d'édition des grants, de migration utilisateur,
de rôle reçu dans un DTO ni de permission `lead.delete`. Une permission inconnue,
une session absente, une rotation de secret requise ou une erreur du fournisseur
refuse l'accès. Les contextes proviennent des références, du lead et des
collaborations actives chargés côté serveur.

| Rôle technique / métier | Tags sur un lead | Définitions tags | Référentiels | Disponibilité programme |
| --- | --- | --- | --- | --- |
| SUPER_ADMIN / Super Admin | Global | Global | Gestion/archivage global | Global |
| ADMIN / Admin | Ses campus explicites | CAMPUS de ses campus | Lecture globale et campus ; gestion/archivage CAMPUS seulement | Ses campus |
| MANAGER / Manager commercial | Ses campus explicites | Refus | Lecture active applicable | Refus |
| ADMISSIONS / Conseiller | Campus autorisé ET propriétaire ou collaborateur actif | Refus | Lecture active applicable | Refus |
| AUDITOR / Lecteur | Refus | Refus | Seulement références utilisées par une ressource déjà lisible | Refus |

Une session Admin historiquement GLOBAL ne transforme jamais un grant CAMPUS en
grant GLOBAL. `settings.global.manage` reste réservé au Super Admin. Le catalogue
Campus, les définitions de programmes et les bourses sont globaux. Les seuls
codes de bourse acceptés sont 20, 30 et 40. Ce lot gère les définitions de bourses,
pas un nouveau processus métier d'attribution financière.

## Persistance, historique et erreurs

Quatre nouvelles tables : `crm_references`, `crm_reference_keys`,
`crm_program_availability`, `crm_lead_tags`. Pas de modification des colonnes
historiques Lead. Les alias sont explicites, versionnés et conservés lors d'un
renommage. Une même clé canonique ne peut désigner deux définitions dans une
portée. Une collision GLOBAL/CAMPUS lors d'une résolution par texte est refusée,
jamais résolue par préférence implicite.

Les codes de campus doivent correspondre aux périmètres configurés des
collaborateurs ; aucun périmètre utilisateur n'est créé ou réécrit par ce lot.
Le code Campus conserve sa casse et sa limite de 80 caractères ; seules ses clés
de recherche sont normalisées. La disponibilité affiche sa version lue depuis
l'API, sans demander à l'administrateur de deviner un compteur de concurrence.
Les définitions utilisées ne sont pas supprimées. Les tags retirés conservent
leur association inactive. Un changement de portée d'une définition déjà utilisée
est refusé ; déplacer des usages nécessite une décision distincte.

Chaque mutation de définition ou de tags et son événement d'audit sont atomiques
dans une transaction Serializable. L'affectation de tags vérifie la version du
lead, journalise `TAGS_CHANGED` et conserve un reçu d'idempotence lié au payload
et à l'acteur. Cet événement système n'est pas accepté comme interaction manuelle.

Une référence inconnue/archivée lors d'une nouvelle sélection renvoie 422
`REFERENCE_VALUE_UNKNOWN` avec le nom du champ uniquement. Une édition sans
changement de référence conserve les anciennes chaînes exactement. L'inventaire
LEGACY est une action explicite Super Admin, non exécutée au démarrage : création
d'entrées archivées pour les valeurs inconnues, sans UPDATE de lead, rapprochement
flou ni activation automatique. Les erreurs de stockage sont expurgées.

L'import persistant place les lignes inconnues en revue, sans auto-créer de
référence et sans annuler les lignes valides. Une correction est rejouée dans un
nouveau lot idempotent ; le même lot avec un payload modifié reste refusé. La
provenance d'un doublon fiable peut être attachée sans écraser le lead canonique.

## Validation et rollback

Fixtures entièrement synthétiques. Tests des grants, anti-IDOR, fournisseur en
erreur, DTO fermés, collisions, archivage/restauration, historique, transaction
annulée, import partiel et rejeu. Test PostgreSQL strictement limité à une base
éphémère locale dédiée, plus tests Playwright des contrôles responsive.

Rollback : revert applicatif revu sans réécriture Git, conservation des quatre
tables et de l'audit. L'ancienne application peut encore lire les colonnes texte
inchangées. Aucun effacement de volume de recette ni rollback SQL destructif.
Voir aussi le rollback adjacent à la migration.

CRMY-54 reste au préflight : son accès Lecteur et Admin campus est défini dans
ses propres critères. Aucun écran de consultation d'audit supplémentaire ni
contrat de configuration dynamique n'est développé ici.
