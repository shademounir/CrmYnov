# Moteur local d’affectation des leads — CRMY-130

Le moteur sélectionne exclusivement des collaborateurs actifs, non suspendus, non exclus et sous leur capacité déclarée.

## Historique CRMY-130

La règle historique en mémoire exigeait un repli global et refusait la coexistence Source/Campagne avec `assignment_rule_ambiguous`. Ce comportement historique n'est pas la nouvelle politique des configurations persistantes CRMY-171.

## Arbitrage PO CRMY-171 — 5 septembre 2026, commentaire Jira 12241

Dans le seul campus canonique autorisé : Campagne, sinon Source, sinon repli du campus. Sans configuration applicable : UNASSIGNED avec motif explicite. Deux règles de même priorité restent ambiguës. Une règle sélectionnée invalide, une erreur technique ou un refus de permission ne déclenchent aucun repli silencieux. Aucune reprise automatique des règles en mémoire et aucune réaffectation des Leads existants.

Les configurations Prisma sont versionnées par campus et chaque version conservée avec son audit transactionnel. La lecture/configuration via `/assignment/config` exige `campusId` ; l'écriture exige aussi `expectedVersion`. Les permissions dynamiques existantes s'appliquent. Le worker lit la même version et trace la version/règle/empreinte de candidats dans l'audit de l'import. Les curseurs sont isolés par campus et version. Une configuration vide désactive les règles sans supprimer l'historique.

## Arbitrage PO : automatisation et audit unique (6 septembre 2026)

`automaticEnabled` est l'état d'affectation automatique du campus, distinct du `enabled` du connecteur Sheets et des `enabled` des règles. L'écran `/admin/assignment` lit puis enregistre ce booléen avec la version attendue et les règles conservées. Il est stocké avec le snapshot JSON immuable de la nouvelle version ; aucune migration, copie de règles en mémoire ou réécriture d'historique. Les anciens snapshots en tableau conservent leur sémantique de règles actives. Une lecture ou un snapshot invalide provoque un refus, pas un repli.

Un worker d'import autorisé applique directement l'affectation lorsque le campus l'autorise, y compris si sa stratégie est FIXED : ce n'est pas une affectation manuelle. Quand `automaticEnabled=false`, il importe sans affecter et rend `assignment_automation_disabled` explicite ; le connecteur peut rester actif. Les affectations FIXED manuelles restent soumises aux permissions, au campus et à l'éligibilité des candidats, mais ne sont pas bloquées par ce toggle. Campagne → Source → repli → UNASSIGNED demeure inchangé.

`/assignment/auto` reste une décision seule, sans modification Lead. Cette séparation n'exige aucune confirmation humaine par ligne d'import automatique. `/assignment/simulate` ne consomme ni curseur ni audit.

Chaque affectation effective produit un seul `LEAD_ASSIGNED`, enrichi dès son insertion des métadonnées minimales d'origine, référence de décision et version des règles. La confirmation HTTP conserve version/scope, référence idempotente, empreinte de requête et destinataire ; l'import conserve la référence de ligne et la règle. Les workers sont explicitement SYSTEM, jamais des administrateurs fabriqués. Aucun second `LEAD_AUTO_ASSIGNED` n'est émis pour cette mutation. Les anciens événements restent lisibles, inchangés. Les événements d'import (suivi de ligne) et les décisions seules restent distincts, sans annoncer une seconde affectation.

La mutation, le curseur et l'audit partagent la même transaction. Rejeu : aucun audit supplémentaire. Échec d'audit : rollback complet ; l'endpoint unitaire d'affectation conserve son refus contrôlé `409 assignment_failed`, sans exception SQL exposée. CRMY-54 maintient sept mutations = sept audits ; seuls les champs minimisés de l'événement d'affectation sont enrichis selon cet arbitrage.

Rollback applicatif : désactiver le connecteur Sheets, conserver tables, versions, curseurs, reçus et audits ; ne pas réimporter une ancienne configuration volatile ni supprimer des tables. Les anciennes versions applicatives ne doivent pas réactiver un connecteur dont elles ne comprennent pas la configuration.

`ROUND_ROBIN` utilise un curseur versionné. `CONTROLLED_RANDOM` dérive un index reproductible de l’identifiant de règle et de la clé d’événement avec SHA-256. La clé d’événement garantit l’idempotence. La simulation retourne `mutated=false` et ne crée aucune décision.

La configuration et son historique sont réservés à `MANAGER`, `ADMIN` et `SUPER_ADMIN`. Les événements d’audit ne contiennent ni coordonnées de candidat, ni secret, ni URL de base. Les adaptateurs Forminator/Zapier futurs doivent fournir une clé d’événement synthétique ou minimisée et appeler le même contrat `assign`.

La migration est additive et ne doit être appliquée que par le contrôle CI sur PostgreSQL éphémère. Le rollback applicatif revient au commit précédent et conserve les tables inutilisées ; aucune base persistante n’est contactée par cette livraison.

## Arbitrage décision seule — 6 septembre 2026, commentaire Jira 12274

`POST /assignment/auto` conserve le contrat historique : il enregistre une décision persistante, réserve la position du curseur applicable et écrit `ASSIGNMENT_DECISION_CREATED` dans une seule transaction PostgreSQL. Aucun Lead, propriétaire ou événement de timeline n'est modifié. L'événement ne prétend pas qu'une affectation effective a eu lieu. Celle-ci appartient exclusivement aux endpoints de confirmation.

Le `eventKey` existant identifie le rejeu : même clé et même Lead autorisé → décision originale, y compris version des règles, sans nouvelle consommation. Une clé réutilisée pour un autre Lead est refusée. Deux clés distinctes restent deux demandes, même pour le même Lead. Un conflit concurrent est explicite ; aucun curseur ni audit partiel n'est validé. Une défaillance d'audit annule toute la décision.

`POST /assignment/simulate` est strictement en lecture : aucun Lead, curseur, historique de décisions ou audit métier. La simulation manuelle d'import utilise des positions virtuelles locales et ne réserve pas les destinataires ; la confirmation réévalue les règles et permissions. Ses mappings manuels restent en mémoire, limite distincte non migrée par CRMY-171.

L'historique expose seulement les décisions réellement persistées et leur contexte/version, sans recalcul avec les règles actuelles. Le tableau d'affectation et les indicateurs de charge lisent les règles Prisma autorisées ; la capacité conserve l'agrégation maximale existante par conseiller. Les anciens totaux de lots non persistés restent explicitement indisponibles (`null`, `UNAVAILABLE_NOT_PERSISTED`), jamais reconstruits ni présentés comme zéro.
