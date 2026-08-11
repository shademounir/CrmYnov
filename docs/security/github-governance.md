# Gouvernance GitHub

## Dépôt officiel

- Propriétaire : `shademounir`
- Dépôt : `CrmYnov`
- Branche stable : `main`
- Branche d’intégration : `develop`

## Protections attendues

`main` et `develop` doivent appliquer :

- pull request obligatoire ;
- gouvernance `solo-owner` acceptée pour bootstrap, MVP, DEV et STAGING ;
- validation manuelle par le Product Owner ;
- label `po-approved` réservé au Product Owner ;
- checks obligatoires réussis ;
- conversations résolues ;
- historique linéaire ;
- administrateurs soumis aux règles ;
- force-push interdit ;
- suppression interdite.

Les checks obligatoires seront ajoutés après leur première exécution réussie afin d’éviter une dépendance circulaire pendant le bootstrap.

## Politique de fusion

- Squash merge uniquement.
- Auto-merge désactivé.
- Aucune fusion par Codex ou une automatisation.
- Suppression automatique de la branche après fusion.
- Aucune fusion vers `main` pendant la Gate -1.
- `main` reçoit uniquement une release explicitement validée.

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
