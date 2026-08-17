# Gouvernance GitHub

## Dépôt officiel

- Propriétaire : `shademounir`
- Dépôt : `CrmYnov`
- Branche stable : `main`
- Branche d’intégration : `develop`

## Protections attendues

`main` et `develop` doivent appliquer :

- pull request obligatoire ;
- gouvernance `automated-policy` pour DEV, STAGING et releases techniques Gate ;
- gouvernance `manual-po` pour PROD et opérations sensibles ;
- labels `policy-approved` technique et `po-approved` humain strictement séparés ;
- checks obligatoires réussis ;
- conversations résolues ;
- historique linéaire ;
- administrateurs soumis aux règles ;
- force-push interdit ;
- suppression interdite.

Les checks obligatoires seront ajoutés après leur première exécution réussie afin d’éviter une dépendance circulaire pendant le bootstrap.

## Politique de fusion

- Squash merge uniquement.
- Auto-merge natif autorisé uniquement après validation `automated-policy`.
- Fusion Codex autorisée sans bypass uniquement dans le périmètre automatisé.
- Suppression automatique de la branche après fusion.
- `main` reçoit uniquement une release Gate validée par politique ou une
  release PROD validée manuellement.

## Contrôles CI cibles

- lint et format check ;
- type-check ;
- tests unitaires ;
- build ;
- SonarQube Cloud ;
- CodeQL ;
- dependency review et Dependabot ;
- secret scanning et push protection lorsque disponibles ;
- scans dépendances, IaC et image ;
- génération SBOM.

## Gouvernance des migrations Prisma

Une migration Prisma peut relever de `automated-policy` seulement lorsque le
validateur versionné conclut sans ambiguïté qu'elle est additive et code-only.
Elle doit être accompagnée d'un `rollback.md`, porter les marqueurs
`additive`, `ephemeral-only` et `rollback-documented`, puis être appliquée sur
le service PostgreSQL éphémère de la CI. La base est vide, les identifiants sont
synthétiques et l'URL cible exclusivement `127.0.0.1:5432/crm_policy`.

Sont admissibles : création de table ou d'index, ajout de colonne nullable,
ajout avec valeur par défaut sûre, clé étrangère sur une table créée dans la
même migration et extension compatible d'enum. Un index unique exige le
marqueur supplémentaire `uniqueness-validated`.

Restent `manual-po` : `DROP`, `TRUNCATE`, mutations de données, renommages,
suppressions, changements de type, `SET NOT NULL` non prouvé, SQL brut ambigu,
chemin inconnu, URL ou credential persistant, Cloud SQL, GCP, STAGING, PROD et
toute exécution manuelle exceptionnelle. Une migration additive mélangée à un
fichier sensible reste `manual-po`. Tout échec ou preuve absente est
fail-closed.

Le rollback automatisé d'une migration additive consiste à revenir au code
précédent et à laisser les nouveaux objets inutilisés. Leur suppression est une
opération destructive distincte, toujours soumise à `manual-po`. La base CI
éphémère est détruite avec le job ; aucun rollback n'est exécuté contre une
base persistante.

Après fusion manuelle de cette gouvernance, l'ordre applicatif recommandé est :

1. CRMY-53 — socle d'audit append-only nécessaire aux opérations sensibles ;
2. CRMY-38 — administration des utilisateurs et révocation des sessions ;
3. CRMY-36 — changement obligatoire du secret initial avec audit disponible ;
4. CRMY-39 — modification dynamique des rôles et périmètres après stabilisation
   de l'administration des utilisateurs.

## Contrôles manuels restants

- Vérifier que la liaison Jira affiche branches, commits et PR contenant une clé `CRMY`.
- Confirmer l’organisation et le projet SonarQube Cloud avant d’ajouter un secret `SONAR_TOKEN`.
- Finaliser puis enregistrer les noms exacts des checks CI obligatoires.
- Réévaluer le besoin d’un second reviewer avant l’ouverture de PROD à des
  données réelles.
- Maintenir `main` inchangée jusqu’à une release validée.

## Rollback

- Fermer une PR non fusionnée.
- Revenir sur une PR fusionnée par une PR de revert.
- Restaurer un réglage GitHub depuis l’état documenté avant changement.
- Ne jamais utiliser de push forcé ni réécrire l’historique.
