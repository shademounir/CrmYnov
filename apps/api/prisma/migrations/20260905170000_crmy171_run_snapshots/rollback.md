# CRMY-171 — Snapshots, versions et reçus

Les index uniques portent sur les nouvelles tables vides de versions (connecteur/version) et reçus (run/row_key). Les anciennes exécutions conservent les deux colonnes de snapshot nulles.

## Validation

Les migrations ont été appliquées ensemble sur PostgreSQL éphémère synthétique dans les harnais CRMY-171. Les scénarios vérifient versionnement, concurrence, idempotence et atomicité audit/métier. Aucun déploiement distant n'est autorisé par ce document.

## Désactivation et rollback applicatif

Désactiver les connecteurs par l'API autorisée avant de retirer les workers, attendre la fin de la transaction active et vérifier le refus des baux périmés. Une version applicative antérieure ne doit pas exécuter une configuration qu'elle ne comprend pas. Conserver tables, colonnes, index, contraintes, configurations, versions, reçus, curseurs, provenance et audits.

Aucun rollback SQL destructif n'est proposé ou exécuté sur une base contenant des valeurs utiles. Sur une base jetable créée uniquement par un harnais, sa gestion reste celle du harnais ; ne jamais réinitialiser la base de prévisualisation tmpfs existante. Ne pas restaurer automatiquement une sauvegarde, recalculer l'historique ou réaffecter les Leads.
