# Premier accès : autorisation de l'émission temporaire

Le contrôleur `UserController.issueTemporarySecret` exige le rôle `SUPER_ADMIN`.
Le registre fermé des routes dynamiques doit en outre le lier à
`users.roles.assign` ; une route absente est refusée avant le contrôleur. Sur
DEV, cette omission produisait HTTP 403 après la création réussie d'un compte.

L'émission garde ses protections existantes : compte actif, confirmation et
motif autorisé, secret généré côté API, stockage de son empreinte dans
PostgreSQL, révocation des sessions, premier changement obligatoire et audit
sans secret. Les autres rôles et les routes inconnues restent refusés. Aucun
secret n'est livré dans le code, les journaux ou les commentaires de PR.

Après fusion et déploiement de l'API, la recette doit émettre l'accès depuis
l'administration DEV sur le compte autorisé, constater l'affichage unique dans
l'interface puis faire effectuer au titulaire sa première connexion et son
changement de secret. La présence d'un compte sans cette preuve n'établit pas
que l'accès est utilisable. La remise du secret doit rester dans un canal
approuvé, jamais dans un ticket ou un chat.

Rollback : revenir au digest API précédent par la procédure Cloud Run/Terraform
contrôlée. Cela rétablit le refus de l'émission, sans supprimer le compte ni
modifier artificiellement les empreintes, sessions ou audits persistants.
