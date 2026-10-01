# Mapping versionné et dry-run d’import

CRMY-57 ajoute une étape strictement non mutative entre le profilage du fichier et la confirmation d’un import. Elle utilise les mêmes règles de normalisation, de statut historique, de déduplication et d’affectation que le pipeline d’ingestion.

## Contrats

- `GET /lead-import/mappings` retourne la dernière version de chaque mapping, sans donnée métier.
- `POST /lead-import/mappings` crée une version immuable avec contrôle optimiste `expectedVersion`.
- `POST /lead-import/dry-runs` applique une version exacte et retourne uniquement des compteurs, numéros de lignes et motifs stables avec `mutated: false`.

Les mappings intégrés `forminator-zapier-v1` et `legacy-crm-canonical-v1` sont immuables. Le second représente uniquement la feuille canonique `LEADS YNOV.MA`. Les autres feuilles historiques restent des provenances complémentaires et ne peuvent écraser ni statut, ni affectataire, ni relance, ni commentaire canonique.

Chaque colonne source doit être déclarée exactement une fois comme champ CRM, métadonnée ou colonne ignorée avec justification. Une colonne inconnue, un ordre différent, une valeur ressemblant à une formule ou une version absente est refusé sans déduction silencieuse.

## Déduplication et statuts

L’ordre est : identifiant externe et système technique, email normalisé, puis téléphone normalisé. Une collision contradictoire va en revue manuelle. Un match fiable est compté comme doublon sans mutation. Les doublons internes au fichier sont également signalés.

Le mapping des statuts historiques reste celui validé dans `docs/imports/source-mapping.md`. Le libellé brut est conservé pour le futur import confirmé ; un statut inconnu reste en revue manuelle. Les statuts JobInTech ne pilotent jamais automatiquement le statut CRM.

## Affectation simulée

`UNASSIGNED`, `FIXED`, `ROUND_ROBIN` et `CONTROLLED_RANDOM` utilisent la configuration Manager existante. La simulation Round-robin calcule une répartition locale sans avancer le curseur. L’absence de candidat éligible laisse la ligne non affectée. Aucun lead existant n’est réaffecté.

## Sécurité et exploitation

- rôles autorisés : Manager, Admin et Super Admin ;
- 100 lignes et 100 colonnes maximum par appel ;
- 4 000 caractères maximum par cellule ;
- aucune formule, donnée inconnue ou version implicite ;
- aucune identité dans l’audit ou la réponse technique ;
- aucune persistance de fichier brut ou de ligne ;
- fixtures exclusivement synthétiques ;
- aucune connexion Forminator, Zapier, Google Sheets ou cloud.

La page `/imports/mapping` conserve l’aperçu dans l’état du navigateur, le transmet uniquement à l’API locale pour le dry-run sans persistance, puis n’affiche que le résultat expurgé. La confirmation et l’import réel sont des étapes séparées. Les canevas de référence réels ne doivent jamais être saisis dans cette interface de développement ni transmis à un environnement distant.

## Rollback

Retirer les routes et services CRMY-57 restaure le profilage CRMY-56 et l’ingestion confirmée CRMY-58. Aucun rollback de données n’est requis : cette tranche ne contient ni migration Prisma ni écriture métier.
