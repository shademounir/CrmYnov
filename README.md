# CrmYnov

CRM Admissions & Prospection de Ynov.

> État du projet : initialisation technique dans la Gate -1.
>
> Aucune fonctionnalité métier, donnée personnelle ou ressource Google Cloud n’est incluse à ce stade.

## Référentiels

- Cahier des charges opposable : `CRM_Ynov_Cahier_des_charges_Architecture_DevSecOps_v1.4.2_FINAL.docx`.
- Backlog Jira : projet `CRMY`.
- Dépôt officiel : `shademounir/CrmYnov`.

## Stratégie de branches

- `main` : releases validées uniquement.
- `develop` : intégration.
- `feature/CRMY-<numéro>-description` : travaux fonctionnels ou techniques planifiés.
- `fix/CRMY-<numéro>-description` : corrections.
- `release/<version>` : préparation d’une release validée.

Les écritures directes sur `main` et `develop` sont interdites. Toute modification passe par une pull request, une validation humaine et les contrôles requis.

## Sécurité

- Aucun secret, jeton, mot de passe ou donnée personnelle dans Git.
- Exemples d’environnement avec valeurs fictives uniquement.
- Authentification GitHub Actions vers Google Cloud prévue par WIF/OIDC, sans clé JSON persistante.
- Les vulnérabilités doivent être signalées selon [SECURITY.md](SECURITY.md).

## Contribution

Consulter [CONTRIBUTING.md](CONTRIBUTING.md) avant toute branche, tout commit ou toute pull request.
