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
