# Premier déploiement GCP DEV

## Périmètre

- Projet unique : `crmynov-dev-n7x4q2`.
- Région unique : `europe-west1`.
- Web et API Cloud Run à zéro instance minimum et deux instances maximum.
- PostgreSQL 17 privé, zonal, `db-f1-micro`, sauvegardes quotidiennes et PITR 7 jours.
- Données exclusivement synthétiques.
- Sheets, téléphonie entrante et enregistrement audio désactivés.
- Agent Windows via HTTPS sur le gateway Web `/agent/`; le secret SIP reste local.

## Préconditions bloquantes

Le bucket historique attendu n'est pas visible par le compte institutionnel et
le bucket `crmynov-tfstate-dev-n7x4q2` répond `404`. Ne pas en déduire qu'il est
absent d'un projet Bootstrap inaccessible. Le root
`infra/bootstrap/dev-runtime-state` fournit une solution DEV bornée, mais son
application initiale et la conservation de son petit état local doivent être
tracées avant d'initialiser le backend runtime.

Le provider WIF historique du projet Bootstrap reste la cible. Les variables de
l'environnement GitHub `DEV` doivent contenir uniquement ses références :

- `GCP_WIF_PROVIDER` ;
- `GCP_WIF_DEPLOY_PRINCIPAL` ;
- `GCP_DEPLOY_SERVICE_ACCOUNT` ;
- `GCP_DEV_STATE_BUCKET`.

Ne pas créer un second pool WIF dans DEV et ne pas utiliser de clé de compte de
service. Si le provider historique ne peut pas être lu, obtenir un accès IAM
minimal au Bootstrap pour le consulter et l'administrer ; ne pas recréer le
projet.

## Séquence CI/CD

### Exception initiale CRMY-30 autorisée le 22 septembre 2026

Le PO autorise le provisioning DEV avant fusion de PR96 afin de prouver la
restauration Cloud SQL. Le même backend `runtime/dev` reste seul propriétaire
des ressources ; aucun `-target` ni état parallèle n'est utilisé. Première phase :
images vides, `deploy_services=false`, `scheduler_paused=true`. Deuxième phase :
`job_image` contient uniquement le digest API contrôlé, les images des services
restent vides. Les jobs ne s'exécutent que sur commande explicite et le Scheduler
reste en pause. Les services Web/API seront publiés après fusion personnelle.

L'identité humaine existante autorisée peut réaliser cette phase ; cette
exécution ne prouve pas le fonctionnement du WIF institutionnel. `gh-deploy-dev`
est géré ici dans DEV ; la racine Bootstrap WIF ne doit pas gérer en parallèle
cette même identité. Un futur transfert d'état nécessite une opération explicite.

PostgreSQL 17 est explicitement en édition `ENTERPRISE` pour `db-f1-micro`.
Les jobs utilisent Direct VPC et une connexion TCP privée chiffrée. Les versions
initiales des secrets de connexion sont conservées ; de nouvelles versions TCP
privées sont ajoutées sans suppression. Le job de droits retire `cloudsqlsuperuser`,
CREATEDB et CREATEROLE du compte applicatif, interdit CREATE dans le schéma public,
borne ses connexions à 20 et refuse son accès à `_prisma_migrations`.

Un déploiement ultérieur conserve les images applicatives existantes pendant
la phase de migration grâce à `job_image`. Il ne remet pas les services à zéro.
L'instance de restauration est limitée au même petit gabarit pour au plus
24 heures : enveloppe ponctuelle de 2 USD, hors rétention normale des sauvegardes.
Sa suppression seule est autorisée après validation des preuves.

Le workflow `deploy-dev.yml` refuse un SHA différent du HEAD courant de
`origin/develop`, toute action Terraform de suppression et toute image non liée
à ce SHA.

1. Appliquer les ressources fondamentales sans images ni services.
2. Construire et pousser API/Web, puis résoudre leurs digests immuables.
3. Scanner les deux images sans `ignore-unfixed` et refuser tout High/Critical.
4. Créer les jobs, puis exécuter dans l'ordre : migration Prisma avec
   `crm_migrator`, octroi borné à `crm_runtime`, seed synthétique idempotent.
5. Créer API/Web, conserver le Scheduler en pause et vérifier `/api/health`.
6. Dépauser le Scheduler seulement après le smoke test.

L'API n'accède jamais au secret de migration. L'identité Web transmet le jeton
CRM dans `Authorization` et son jeton Google dans
`X-Serverless-Authorization`. L'API reste privée derrière Cloud Run IAM ; seul
le Web est public et l'authentification CRM reste obligatoire.

## Coût et limites

Estimation de travail au 22 septembre 2026 : USD 25 à 60 par mois en usage DEV
léger, principalement Cloud SQL. Le calcul minimal de `db-f1-micro` est
USD 0,0105/heure, soit environ USD 7,67 pour 730 heures, avant stockage,
sauvegardes et réseau. Cloud Run est facturé à l'usage et scale à zéro. Artifact
Registry inclut les premiers 0,5 Gio/mois. La borne d'autorisation reste une
alerte mensuelle de USD 150 ; une alerte ne bloque pas automatiquement les
dépenses. `db-f1-micro` n'a pas de SLA et ne convient qu'à DEV.

Références officielles :

- https://cloud.google.com/sql/pricing
- https://cloud.google.com/run/pricing
- https://cloud.google.com/artifact-registry/pricing

## Vérifications et retour arrière

- Le plan enregistré doit indiquer zéro suppression avant chaque apply.
- Les migrations s'exécutent avant toute révision applicative accessible.
- Les images précédentes restent adressables par digest dans Artifact Registry.
- Le rollback applicatif consiste à réappliquer les digests précédents ; aucun
  rollback destructif de migration n'est automatisé.
- Cloud SQL et Cloud Run ont la suppression protégée. Restaurer la base exige
  une décision distincte et une preuve de restauration, jamais la seule
  lisibilité d'une sauvegarde.
- En cas d'échec avant smoke test, laisser le Scheduler en pause et ne pas
  exposer un service partiellement initialisé.

## Preuve CRMY-30 : migration N-1

La preuve reproductible utilise uniquement PostgreSQL 17.6 éphémère et des
données synthétiques :

```powershell
$env:CRMY171_MIGRATION_TEST = "true"
node --test scripts/pr-policy/tests/migration-postgres.test.mjs
```

Le test crée une base vierge et une base antérieure peuplée, applique les
migrations restantes, compare les lignes antérieures avant/après et contrôle
les contraintes. Il ne touche ni la base de recette, ni `_prisma_migrations`
d'une base persistante.

## Preuve CRMY-30 : sauvegarde et restauration Cloud SQL

Cette preuve ne peut être exécutée qu'après la création de l'instance Cloud SQL
DEV. Elle n'est pas un prérequis technique à la fusion du code Terraform ; elle
est une validation d'exploitation post-apply. Tant qu'elle n'est pas exécutée,
le critère Jira correspondant reste ouvert.

1. Vérifier le projet `crmynov-dev-n7x4q2`, la région `europe-west1`, le SHA
   intégré et l'absence de données réelles. Laisser le Scheduler en pause et
   arrêter les producteurs DEV avant la sauvegarde.
2. Relever l'identité exacte de l'instance source, sa configuration de
   sauvegarde, l'heure serveur, le nombre de migrations appliquées et des
   compteurs exclusivement synthétiques. Ne jamais consigner de secret ou de
   chaîne de connexion.
3. Créer une sauvegarde Cloud SQL à la demande et conserver son identifiant, son
   état final, ses horodatages, le projet et l'identité de l'instance. Une
   sauvegarde seulement lisible ne constitue pas une restauration testée.
4. Restaurer cette sauvegarde dans une instance temporaire distincte, privée,
   dans le même projet DEV et la même région. Ne jamais restaurer sur l'instance
   source et ne jamais modifier son historique Prisma.
5. Avec une identité de vérification au moindre privilège, confirmer la version
   PostgreSQL, l'intégrité du schéma, le nombre et les checksums des migrations,
   puis comparer les compteurs synthétiques attendus. Exécuter une lecture
   métier bornée ; aucune mutation n'est nécessaire pour prouver la restauration.
6. Conserver une preuve expurgée : commandes sans credentials, identifiants des
   opérations, résultats, horodatages, compteurs et erreurs éventuelles. Relier
   la preuve au SHA exact déployé et à CRMY-30.
7. Garder l'instance temporaire isolée jusqu'à revue de la preuve. Sa suppression
   est une opération séparée et contrôlée ; elle ne doit jamais viser la source,
   ses sauvegardes ou l'état Terraform du runtime.

Échec ou ambiguïté : laisser les producteurs arrêtés, ne pas rejouer une
restauration sur la source et conserver les deux instances pour diagnostic. Le
retour arrière applicatif reste le redéploiement des digests précédents ; une
restauration de données n'est jamais déclenchée automatiquement.
