# Interface locale reliée à l’API persistante

## Contrat

L’interface Next.js appelle exclusivement `/api/crm/*` sur sa propre origine. Le route handler transmet les requêtes à NestJS via la variable obligatoire `CRM_API_INTERNAL_URL`. L’image Web la fixe au service Compose interne `http://api:3001`. Pour un lancement Next.js hors Docker, la fournir explicitement avec l’adresse locale de NestJS. Une valeur absente ou invalide provoque un refus fermé.

Le Web exige aussi `CRM_PUBLIC_ORIGIN` pour les mutations, par exemple
`http://localhost:3000` dans Compose. Pour une preview sur `127.0.0.1:3040`,
déclarer `CRM_PUBLIC_ORIGIN=http://127.0.0.1:3040` dans le même processus Web,
avant son lancement. Un ancien lanceur ne déclarant que l'URL API doit être
actualisé : aucune origine n'est déduite implicitement des en-têtes reçus.
Le contrat et les refus contrôlés sont décrits dans `docs/security/browser-origin.md`.
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
