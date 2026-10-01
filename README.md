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

## Développement local

Pré requis : Node.js 22, npm 10, Docker Desktop et Docker Compose. Toutes les
versions npm sont verrouillées dans `package-lock.json`; `.env.example` ne contient
que des valeurs synthétiques locales.

```powershell
npm ci --ignore-scripts
npm run prisma:generate
npm start
```

`npm start` construit et démarre PostgreSQL, l'API NestJS et le frontend Next.js,
puis attend leurs healthchecks. Les points de contrôle sont :

- frontend : `http://localhost:3000/api/health` ;
- API : `http://localhost:3001/health` ;
- OpenAPI : `http://localhost:3001/docs` ;
- PostgreSQL : `pg_isready` dans le conteneur.

Arrêt : `npm stop`. Le volume PostgreSQL local est conservé ; aucune donnée réelle
ne doit y être chargée.

## Contrôles locaux

```powershell
npm run lint
npm run type-check
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm run prisma:validate
npm run docker:config
```

La validation d'environnement échoue explicitement si `DATABASE_URL`, les ports
ou le niveau de log sont invalides. Les réponses HTTP propagent uniquement un
identifiant de corrélation filtré et n'exposent aucune variable d'environnement.
