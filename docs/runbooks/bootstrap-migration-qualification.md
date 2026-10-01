# Qualification initiale des migrations pour la prérelease interne

## Constat et correction — 1 octobre 2026

PR104 est fusionnée dans develop : `a3c432841cb2c24a910f362742f18fbbfeb563fe`.
Les modes PR/release sont maintenant `delegated-codex`, après vérification du
grant protégé. Aucune protection GitHub ou exigence technique n'a été supprimée.

Le diff main → develop contient 44 SQL historiques. L'audit détaillé montre que
seul `00000000000000_bootstrap` manquait des trois marqueurs et du rollback.
Toutes les autres migrations passaient déjà avec leurs preuves existantes.
Ce n'est pas un défaut d'exécution SQL ni une raison de réécrire les migrations.

Un `policy.json` lié au SHA-256 original et un `rollback.md` complètent les preuves
du bootstrap. Le validateur audite désormais aussi le SQL immuable lorsqu'un
sidecar est ajouté/modifié, et relit toujours les preuves existantes. Une preuve
absente, vide, malformée ou liée à un autre checksum reste refusée ; aucune
opération destructive ou ambiguë n'est exemptée.

## Résultats réellement obtenus localement

- 66 tests ciblés politique/grammaire réussis ; suite politique/release réussie.
- Audit statique de l'ensemble des 44 migrations réussi après ces corrections.
- PostgreSQL 17.6 isolé, sans port publié ni réseau : 44 SQL appliqués sur base
  vide ; application progressive sur une base avec sonde, collaborateur et Lead
  synthétiques antérieurs, snapshots inchangés après migration.
- Refus réel d'un UUID de sonde dupliqué par sa clé primaire.
- Aucun connecteur Sheets actif ni appel créé dans cette fixture.
- Export custom : 195207 octets, SHA-256
  `765a07252713c21c92b33b1c6508d672ca23860b6463553341a35ecdb9d62200`.
  `pg_restore --list` réussi **puis** restauration réellement exécutée dans une
  troisième base isolée ; les trois snapshots conservés sont identiques.
- Les 44 SQL et leurs empreintes sont inchangés. Le conteneur de preuve et son
  volume sont conservés, arrêt gracieux confirmé avec code de sortie zéro.

Commande reproductible, uniquement sur des ressources synthétiques distinctes :

```powershell
$env:CRMY174_RELEASE_MIGRATION_TEST='true'
node --test scripts/pr-policy/tests/release-migration-postgres.test.mjs
```

## Limites

Ce test applique directement la séquence SQL : il ne régularise pas l'historique
Prisma d'une base existante. La CI exacte de la PR doit encore vérifier Prisma
validate/migrate deploy/status sur sa propre base éphémère. Aucun historique
`_prisma_migrations` de DEV/recette n'a été modifié. Cette restauration locale
n'est pas une nouvelle preuve Cloud SQL ; la preuve Cloud SQL acquise reste
séparée. Les résultats locaux ne valent pas gates distants du nouveau SHA.

Aucune modification métier, agent Windows, IAM, Sheets, Gmail, déploiement ou
passage PROD. Retour arrière applicatif : conserver schéma et données, revert
protégé des outils si nécessaire ; pas de suppression de table ou de volume.
Prérelease uniquement après contrôles distants et décision Codex traçable liée
au SHA exact. PR99/102 et dépendance CRMY-160 → CRMY-161 restent préservées.
