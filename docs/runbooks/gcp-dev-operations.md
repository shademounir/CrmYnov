# Exploitation minimale du CRM DEV

## État observé au 23 septembre 2026

Le Web public et l'API privée Cloud Run, Cloud SQL PostgreSQL 17, les jobs et le
Scheduler existent dans `crmynov-dev-n7x4q2/europe-west1`. Les journaux Cloud Run
sont structurés par la plateforme (`httpRequest`, trace, service et révision).
Les buckets `_Default` et `_Required` conservent respectivement 30 et 400 jours ;
`_Required` est verrouillé. Aucun sink applicatif supplémentaire n'est requis
pour cette prérelease et aucune donnée candidate ne doit être ajoutée aux logs.

Avant ce lot, l'API Cloud Monitoring n'était pas activée et aucun tableau de bord,
uptime check ou canal d'alerte runtime n'était géré. Le Terraform ajoute, sans
l'appliquer automatiquement :

- un contrôle HTTPS de `/api/health` sur le Web ;
- les taux et latences Web/API, le nombre d'instances et le CPU Cloud SQL ;
- des alertes d'indisponibilité, HTTP 5xx, saturation SQL, échec du job de relance
  et commande téléphonique refusée ;
- un tableau de bord `CRM Ynov DEV runtime`.

Le destinataire reste une décision externe. Tant que
`alert_notification_channels` est vide, une politique peut ouvrir un incident
Monitoring mais aucune réception humaine n'est prouvée. Après confirmation du
destinataire : créer ou sélectionner un canal dans le projet, passer son nom de
ressource au plan, appliquer, envoyer un test officiel du canal, puis conserver
l'horodatage et l'accusé de réception expurgés. Les alertes budgétaires ne
remplacent jamais ce test d'exploitation.

## Diagnostic borné

1. Relever le SHA, les digests et les révisions Cloud Run avant toute action.
2. Pour une erreur Web/API, filtrer par service, révision, statut et trace. Ne
   jamais copier cookies, jetons, coordonnées ou payloads métier dans Jira.
3. Pour une relance, comparer Scheduler, exécution du job, événement idempotent et
   notification PostgreSQL. Un Scheduler réussi ne prouve pas la réception UI.
4. Pour une commande téléphonique, corréler la commande CRM, le poste et les
   événements agent. Un clic ou un HTTP 201 ne prouve pas un appel établi.
5. Pour Cloud SQL, examiner connexions, CPU, stockage et erreurs avant toute
   augmentation. DEV est zonal `db-f1-micro`, sans SLA ni haute disponibilité.

## Sauvegarde, reprise et rollback

Couverture actuelle : sauvegarde Cloud SQL quotidienne, PITR sept jours, état
Terraform distant `runtime/dev`, images immuables par digest, secrets dans Secret
Manager et configuration applicative dans Terraform. Les documents candidats
Cloud Storage relèvent de CRMY-90 et ne sont pas couverts tant que ce lot n'est
pas livré. Le transport Pub/Sub relève de CRMY-87.

### Bug applicatif

Conserver le schéma compatible puis redéployer les digests Web/API précédents.
Vérifier healthchecks, authentification, lecture d'un Lead synthétique et job de
relance. Ne restaurer aucune donnée pour corriger un binaire. Réactiver le
Scheduler seulement après contrôle de l'idempotence.

### Perte ou corruption de données

Suspendre les producteurs, choisir une sauvegarde ou un point PITR, restaurer
vers une instance privée isolée, vérifier migrations/checksums et données
synthétiques, puis préparer une bascule contrôlée. Ne jamais restaurer directement
sur la source pour tester. La preuve Cloud SQL déjà acquise est réutilisée ; sa
répétition n'est requise qu'en cas de changement de mécanisme.

Objectifs proposés pour une future production : RPO 15 minutes et RTO 2 heures.
Ils nécessitent validation, exercices mesurés, rétention adaptée et probablement
Cloud SQL régional/HA, donc un coût supérieur à DEV. Ils ne constituent pas un
engagement de service actuel.
