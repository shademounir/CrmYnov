# Import local persistant CSV/XLSX

Ce parcours CRMY-154 est limité à PostgreSQL local et à des fichiers entièrement synthétiques. Les fichiers historiques réels ne sont ni versionnés, ni envoyés en CI, ni importés.

## Parcours opérateur

1. Profiler le CSV/XLSX dans `/imports/profile` : structure, formules, colonnes inconnues et taille sont contrôlées sans mutation.
2. Sélectionner un mapping versionné dans `/imports/mapping`.
3. Exécuter le dry-run. Il renvoie uniquement des compteurs, numéros de ligne, motifs stables et affectations proposées.
4. Réconcilier les collisions et l'affectation, puis cocher la confirmation explicite.
5. Confirmer l'import vers `POST /lead-import/confirmations`.
6. Consulter le rapport immuable et la file « À vérifier ». Les exports de rejets ne contiennent jamais les valeurs des cellules.

La confirmation persiste atomiquement le lot, les Leads créés, la timeline append-only, les provenances, les éléments de revue et le rapport. Un échec annule toute la transaction. Une même clé d'idempotence et le même contenu rejouent le résultat ; un contenu différent est refusé.

## Règles métier

- Une correspondance fiable email, téléphone ou `externalId + source` ajoute une occurrence de provenance sans écraser le Lead canonique.
- Une collision entre plusieurs Leads, un statut inconnu, une formation inconnue ou une affectation non résolue alimente la file « À vérifier ».
- `Doublon` ne crée jamais de Lead.
- Les statuts historiques suivent le mapping Product Owner versionné ; `À relancer` reste `PROSPECT` sans preuve structurée de contact.
- Les activités historiques ne sont créées que lorsqu'un type, un résultat et une date valides sont fournis.
- Un opérateur limité à un campus ne peut importer aucune ligne d'un autre campus.

## Contrôles et rollback

Les migrations sont appliquées uniquement à PostgreSQL éphémère en CI. Aucun `prisma migrate deploy` n'est autorisé vers une base persistante. Le rollback applicatif consiste à désactiver l'endpoint de confirmation et à conserver les données d'audit append-only ; la migration locale additive possède son propre `rollback.md`.
