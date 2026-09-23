# Administration des collaborateurs

Le parcours local permet au seul `SUPER_ADMIN` de créer, filtrer, activer et désactiver un collaborateur. La désactivation révoque immédiatement les sessions et conserve l'historique append-only. Le dernier Super Admin actif est protégé.

La future synchronisation avec Identity Platform reste gelée. Le rollback applicatif remet la version précédente ; les tables additives restent intactes.

Les changements de rôles et périmètres acceptent uniquement un motif contrôlé, exigent une confirmation, enregistrent l’avant/après et révoquent toutes les sessions du collaborateur. Le guard RBAC réserve l’opération au `SUPER_ADMIN`; le dernier Super Admin actif reste protégé.

## Accès initial nominatif

La création d'un collaborateur et l'émission de son accès sont deux opérations
distinctes. Le Super Admin crée d'abord l'identité avec son email professionnel,
ses rôles et son périmètre, puis utilise `POST /users/{id}/temporary-secret` avec
une confirmation et un motif contrôlé. L'API :

- génère le secret côté serveur et ne le renvoie qu'une fois ;
- conserve uniquement un dérivé `scrypt` salé dans PostgreSQL ;
- exige son remplacement à la première connexion ;
- incrémente la version d'authentification et révoque les sessions existantes ;
- audite l'opération sans secret, mot de passe ou lien de connexion.

Le secret affiché doit être copié immédiatement et transmis par un canal approuvé,
jamais dans Jira, Git, un rapport, un journal ou une conversation de travail. Il
n'a pas d'expiration temporelle dans ce lot ; la protection acquise est son usage
temporaire obligatoire et la révocation administrative. Une expiration bornée
reste une amélioration avant production générale.

### Entrées attendues pour un testeur

Nom d'affichage professionnel, email professionnel, rôle, campus et, uniquement
pour le pilote téléphonique, extension SIP éventuelle. Aucun mot de passe n'est
demandé au PO. Avant création, rechercher l'email normalisé afin de refuser un
doublon ; après la recette, désactiver le compte ou renouveler son secret depuis
la même page d'administration.

### Première connexion

1. Le testeur ouvre l'URL DEV communiquée et saisit son email ainsi que le secret
   temporaire reçu hors des outils projet.
2. Le CRM impose immédiatement un nouveau secret conforme à la politique.
3. Le testeur se reconnecte et vérifie uniquement les pages correspondant à son
   rôle et son campus.
4. Le Super Admin confirme dans l'audit l'émission et le changement sans valeur
   sensible, puis vérifie qu'un refus intercampus reste effectif.

La séparation demandeur/approbateur des clôtures reste inchangée : fournir un
compte Manager distinct ne permet jamais au demandeur d'approuver sa demande.
