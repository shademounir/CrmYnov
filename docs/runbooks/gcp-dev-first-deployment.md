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
l'environnement GitHub `dev` doivent contenir uniquement ses références :

- `GCP_WIF_PROVIDER` ;
- `GCP_WIF_DEPLOY_PRINCIPAL` ;
- `GCP_DEPLOY_SERVICE_ACCOUNT` ;
- `GCP_DEV_STATE_BUCKET`.

Ne pas créer un second pool WIF dans DEV et ne pas utiliser de clé de compte de
service. Si le provider historique ne peut pas être lu, obtenir un accès IAM
minimal au Bootstrap pour le consulter et l'administrer ; ne pas recréer le
projet.

## Séquence CI/CD

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
