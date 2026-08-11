# Contribuer à CrmYnov

## Prérequis

Toute contribution doit être rattachée à un ticket Jira `CRMY` autorisé et respecter le cahier des charges V1.4.2 FINAL.

Les fonctionnalités métier restent interdites tant que la Gate -1 n’est pas validée.

## Branches

Créer une branche depuis `develop` :

- `feature/CRMY-<numéro>-description`
- `fix/CRMY-<numéro>-description`
- `release/<version>`

Exemples :

- `feature/CRMY-23-bootstrap-github`
- `feature/CRMY-32-initialiser-monorepo`
- `fix/CRMY-123-corriger-validation`

Ne jamais committer directement sur `main` ou `develop`. Ne jamais réécrire l’historique ni utiliser `--force`.

## Commits

Les commits suivent Conventional Commits et contiennent la clé Jira :

```text
<type>(CRMY-<numéro>): <description impérative et concise>
```

Types usuels :

- `chore` : gouvernance, maintenance ou initialisation ;
- `ci` : intégration continue et contrôles ;
- `docs` : documentation ;
- `feat` : fonctionnalité autorisée ;
- `fix` : correction ;
- `refactor` : restructuration sans changement fonctionnel ;
- `test` : tests.

Exemples :

```text
chore(CRMY-23): initialize GitHub governance
chore(CRMY-32): scaffold CRM monorepo
ci(CRMY-25): add quality and security checks
```

## Pull requests

Toutes les PR fonctionnelles ciblent `develop`. `main` reçoit uniquement des PR de release validées.

Une PR en mode `automated-policy` doit :

1. contenir la clé Jira dans son titre ;
2. utiliser le modèle fourni ;
3. rester limitée au ticket annoncé ;
4. inclure les preuves de tests et l’analyse de sécurité ;
5. recevoir `policy-approved` après audit Codex lié au SHA exact ;
6. ne jamais porter `po-approved` ;
7. résoudre toutes les conversations ;
8. être à jour avec sa branche cible ;
9. réussir tous les contrôles obligatoires, dont `pr-policy` ;
10. être fusionnée par squash, via l’auto-merge natif ou le fallback Codex
    explicitement autorisé, sans bypass.

Codex peut auditer, ajouter `policy-approved`, passer Ready, activer
l’auto-merge et fusionner lorsque la politique automatisée est entièrement
satisfaite. Il ne peut jamais ajouter `po-approved` ni utiliser
`policy-approved` comme preuve d’approbation humaine.

Le mode `manual-po` reste obligatoire pour PROD avec données réelles,
Terraform `apply`/`destroy`, IAM, facturation, secrets, migrations destructives
et exceptions de sécurité. Ces opérations exigent une décision, un commentaire
et une action manuelle du Product Owner.

## Données et secrets

- Utiliser uniquement des données synthétiques.
- Ne jamais committer un fichier `.env` réel.
- Ne jamais enregistrer de secret dans une image Docker, un fichier Terraform, un ticket ou un log.
- Les secrets d’exécution seront stockés dans Google Secret Manager et référencés depuis GitHub Environments.

## Rollback

Une PR non fusionnée est annulée en la fermant. Une PR fusionnée est annulée par une nouvelle PR de revert. Les push forcés, resets distants et suppressions d’historique sont interdits.
