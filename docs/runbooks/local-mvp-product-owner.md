# Recette locale persistante du CRM

Ce runbook couvre uniquement le MVP local CRMY-157 avec des données synthétiques. Il n'utilise ni GCP, ni base distante, ni fichier d'import réel. Les chemins applicatifs principaux sont reliés à l'API NestJS et à PostgreSQL.

## Prérequis

- Docker Desktop avec le moteur Linux opérationnel ;
- PowerShell 7 ou Windows PowerShell 5.1 ;
- Node.js 22 et npm uniquement pour les contrôles hors conteneurs ;
- ports locaux `3000` (Web) et `3001` (API) disponibles ;
- `CRM_LOCAL_MODE=true` ;
- `CRM_LOCAL_SEED_PASSWORD`, mot de passe temporaire de démonstration (14 caractères minimum, majuscule, minuscule, chiffre et caractère spécial, sans espace).

Le mot de passe n'est jamais stocké dans Git. Pour le saisir sans l'afficher et le conserver uniquement dans le processus PowerShell courant :

```powershell
$env:CRM_LOCAL_MODE = 'true'
$env:CRM_LOCAL_SEED_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Mot de passe synthétique' -AsSecureString)).Password
```

Le fichier `.env.example` contient volontairement un placeholder vide. Ne le compléter ni ne créer de fichier `.env` versionné.

## Commandes officielles Windows

Depuis la racine du dépôt :

```powershell
# Démarrage, migration additive et seed idempotent
.\apps\api\scripts\local-mvp.ps1 -Action Start

# Santé et preuves de deux instances, persistance, seed et concurrence outbox
.\apps\api\scripts\local-mvp.ps1 -Action Verify

# Arrêt sans supprimer le volume PostgreSQL
.\apps\api\scripts\local-mvp.ps1 -Action Stop

# Arrêt puis redémarrage sans perte
.\apps\api\scripts\local-mvp.ps1 -Action Restart

# Scénario consolidé : démarrage, preuve, arrêt, redémarrage et nouvelle preuve
.\apps\api\scripts\local-mvp.ps1 -Action Validate

# Nettoyage volontaire du seul volume CRM, avec double confirmation explicite
.\apps\api\scripts\local-mvp.ps1 -Action Cleanup -ConfirmCleanup
```

Après démarrage : Web `http://localhost:3000`, API `http://localhost:3001`, OpenAPI `http://localhost:3001/docs`, santé Web `http://localhost:3000/api/health`, disponibilité API `http://localhost:3001/health/ready`.

## Comptes synthétiques

Tous utilisent le mot de passe temporaire fourni par `CRM_LOCAL_SEED_PASSWORD`, exclusivement pour la recette locale synthétique :

| Profil | Identifiant synthétique |
| --- | --- |
| Super Admin | `super-admin@example.invalid` |
| Admin | `admin@example.invalid` |
| Manager | `manager@example.invalid` |
| Conseiller | `adviser@example.invalid` |
| Lecteur/auditeur | `reader@example.invalid` |

Le seed est rejouable : il réconcilie ces identités et leurs condensats sans créer de doublons.

## Scénarios de recette Product Owner

1. Se connecter avec chaque rôle et vérifier les menus autorisés.
2. Avec le Super Admin, créer un utilisateur synthétique et vérifier sa persistance.
3. Créer un lead synthétique ou exécuter un import synthétique ; ne jamais utiliser un canevas réel.
4. Affecter le lead au Conseiller et constater l'événement dans la timeline.
5. Ajouter une interaction, une relance et un rendez-vous synthétiques.
6. Vérifier la notification interne et le reporting Manager.
7. Demander une clôture avec le Conseiller, puis la décider avec un Manager/Admin distinct.
8. Exécuter `Stop`, puis `Start` et vérifier que les utilisateurs, le lead et son historique sont toujours présents.
9. Rejouer le démarrage/seed et vérifier l'absence de doublon.
10. Exécuter `Verify` et conserver son résultat JSON expurgé comme preuve de deux instances et de concurrence outbox.

## Fiche de remontée

Pour chaque constat, relever : scénario, résultat attendu, résultat réel, capture expurgée, rôle synthétique utilisé, sévérité (`Bloquant`, `Majeur`, `Mineur`, `Suggestion`) et reproductibilité. Ne jamais joindre un secret, un token, une donnée réelle ou un export de base.

## Limites et sécurité

- Le réseau PostgreSQL est interne à Compose ; aucun port de base n'est publié sur l'hôte.
- Le volume nommé est exclusivement `crmynov-local_postgres-data` ; le nettoyage refuse toute autre cible.
- Les services API/Web sont non-root, en lecture seule, sans capacité Linux et avec `no-new-privileges`.
- Les intégrations cloud, téléphonie, Forminator/Zapier réelles, STAGING et PROD restent désactivées.
- Le script refuse une URL de base différente de l'hôte Compose `postgres` ou contenant des paramètres de connexion.
