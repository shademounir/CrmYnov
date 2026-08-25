# Authentification locale persistante

Ce lot active uniquement l'identité locale synthétique sur PostgreSQL. Identity Platform, GCP, STAGING et PROD restent désactivés.

## Préparation

1. Copier `.env.example` vers un fichier `.env` local ignoré par Git.
2. Définir `CRM_LOCAL_SEED_PASSWORD` avec au moins 14 caractères, une minuscule, une majuscule, un chiffre et un caractère spécial.
3. Utiliser exclusivement les domaines réservés `example.invalid` pour les comptes de démonstration.

Le mot de passe ne doit jamais être commité, journalisé ou transmis à la CI.

## Initialisation locale

```powershell
docker compose --env-file .env up -d postgres
$env:DATABASE_URL = "postgresql://$($env:POSTGRES_USER):$($env:POSTGRES_PASSWORD)@127.0.0.1:5432/$($env:POSTGRES_DB)"
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run seed:local --workspace=@crm/api
```

Le seed est idempotent et crée ou réconcilie uniquement `super-admin@example.invalid`. Les secrets sont dérivés avec scrypt et les jetons de session sont stockés sous forme de condensat SHA-256.

## Vérification

- `POST /sessions` accepte uniquement `email` et `password`.
- les rôles et périmètres proviennent du collaborateur persistant, jamais du corps de la requête ;
- une désactivation ou modification d'autorisation révoque les sessions actives ;
- les sessions expirées, révoquées ou liées à une version d'autorisation obsolète échouent de manière fermée ;
- un redémarrage de l'API recharge les sessions actives depuis PostgreSQL.

## Limite exploratoire temporaire

Jusqu'à CRMY-156 et CRMY-157, l'interface peut encore contenir des parcours non connectés. Toute démonstration doit afficher l'avertissement : **« Environnement exploratoire — certaines données ne sont pas encore persistantes. »**
