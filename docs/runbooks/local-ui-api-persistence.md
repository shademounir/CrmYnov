# Interface locale reliée à l’API persistante

## Contrat

L’interface Next.js appelle exclusivement `/api/crm/*` sur sa propre origine. Le route handler transmet les requêtes à NestJS via `CRM_API_INTERNAL_URL`. Le défaut local de développement est `http://127.0.0.1:3001` et le défaut du conteneur de production est le service Compose `http://api:3001`. Une valeur fournie mais invalide provoque un refus fermé.

La connexion échange l’identifiant et le mot de passe avec `POST /api/crm/sessions`. Le jeton renvoyé par NestJS n’est pas exposé au JavaScript navigateur : Next.js le conserve dans un cookie `HttpOnly`, `SameSite=Strict`, limité à la racine. Les requêtes suivantes sont transformées côté serveur en en-tête Bearer. Les réponses sont expurgées de toute propriété `token`.

## Parcours connectés

- connexion locale et récupération d’accès ;
- utilisateurs et rôles ;
- recherche, vues, création, détail, statut et timeline des leads ;
- affectation avec prévisualisation non mutative puis confirmation explicite ;
- relances et rendez-vous ;
- notifications, chat et broadcasts ;
- métadonnées documentaires ;
- imports, profils, rapports de rapprochement et reporting.

Les états de chargement, liste vide et erreur sont visibles et accessibles. Une erreur réseau ou une session absente ne déclenche aucune hypothèse de succès côté interface.

## Limites et sécurité

- Le proxy accepte seulement des segments relatifs alphanumériques bornés et refuse les traversées, chemins absolus et caractères de contrôle.
- Le corps JSON est limité à 1 Mio. Les imports volumineux restent soumis aux limites contractuelles de leurs API.
- Aucun service externe, base distante ou donnée réelle n’est nécessaire.
- Le navigateur ne reçoit jamais l’URL interne du conteneur API.
- Les contrôles RBAC, ownership et anti-IDOR restent l’autorité de NestJS ; l’interface ne les reproduit pas comme décision de sécurité.

## Vérification locale

```powershell
npm ci
npm test
npm run lint
npm run type-check
npm run build
docker compose --env-file .env.example up --build --wait
docker compose --env-file .env.example ps
docker compose --env-file .env.example down --remove-orphans
```

Utiliser uniquement le seed synthétique et fournir `CRM_LOCAL_SEED_PASSWORD` depuis l’environnement local, sans l’écrire dans Git.
