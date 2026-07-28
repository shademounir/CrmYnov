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

Une PR doit :

1. contenir la clé Jira dans son titre ;
2. utiliser le modèle fourni ;
3. rester limitée au ticket annoncé ;
4. inclure les preuves de tests et l’analyse de sécurité ;
5. obtenir au moins une approbation humaine indépendante ;
6. résoudre toutes les conversations ;
7. être à jour avec sa branche cible ;
8. réussir tous les contrôles obligatoires ;
9. être fusionnée par squash lorsque la fusion est autorisée.

L’auteur ne peut pas approuver sa propre PR. Aucune fusion automatique n’est permise.

## Données et secrets

- Utiliser uniquement des données synthétiques.
- Ne jamais committer un fichier `.env` réel.
- Ne jamais enregistrer de secret dans une image Docker, un fichier Terraform, un ticket ou un log.
- Les secrets d’exécution seront stockés dans Google Secret Manager et référencés depuis GitHub Environments.

## Rollback

Une PR non fusionnée est annulée en la fermant. Une PR fusionnée est annulée par une nouvelle PR de revert. Les push forcés, resets distants et suppressions d’historique sont interdits.
