# PR95 — intégration de PR93 et PR94, 22 septembre 2026

## Base et préservation

PR94 fusionnée personnellement à 11:33:37 UTC : `2ac6c823eeb904d0b9ba1f57a6cba23f97bf607a` sur develop. PR93 y figure via `59e80910b2dcdb13628526a2bd2804f6653644a1`.
Point de sauvegarde : `backup/pr95-before-pr94-20260922`, HEAD `47ca906e46529b96179075ea770cd1a0305cf4d4`. Worktree initial propre. Merge explicite, sans rebase, reset ou push forcé.

Les conflits dus au socle squash sont résolus en conservant les clôtures et leurs messages/tests PR93, le scheduler et la persistance Notifications PR94, le catalogue de permission v3 et le panneau d'appel Téléphonie. Les CSS des trois surfaces coexistent. Le diff effectif contre develop reste Téléphonie, permissions associées, assets approuvés, documentation et politique de migrations du pilote ; les migrations déjà appliquées restent inchangées.

## Contrôles locaux exécutés avant publication

- Typage canonique et lint : réussis.
- Tests unitaires canoniques : commande réussie ; Web 173/173, aucun test Web ignoré. Les scénarios API PostgreSQL conditionnels ne sont pas assimilés à ces tests unitaires.
- Intégration isolée : 44 migrations Prisma appliquées sur base vide ; Notifications, persistance Téléphonie et association/polling/révocation agent : 3/3 exécutés, aucun skip. Base identifiée par nonce, sans données privées et sans producteur SIP. Le conteneur dédié est arrêté après contrôle.
- Migrations Téléphonie : test vide/peuplé réussi, données préexistantes conservées, contraintes/unicité/élargissement contrôlés et ordre de rollback essayé dans une transaction annulée. Aucune modification des historiques Prisma de recette.
- Les deux intégrations Téléphonie sont aussi raccordées au runner LCOV canonique ; l'accès à sa base synthétique exige le nonce attendu. Aucun seuil, filtre de couverture ou exclusion modifié.
- Scan secrets et tests de politique migrations ciblés : 22/22 réussis.
- Agent natif : compilation Release via SDK conservé 5.5.21, 0 erreur/avertissement. Self-test via runtime .NET conservé : DPAPI, journal/rejeu, diagnostic expurgé, disponibilité et protocole opaque réussis. Le lancement direct de l'apphost de build n'a pas trouvé le runtime ; cela n'est pas une preuve d'échec du paquet autonome installé.
- Installeur : compilation réussie avec ZIP et métadonnées pilote conservés ; première tentative sans paramètres refusée par la garde de compilation. Aucun installeur installé ou redistribué par ce contrôle.

Ces contrôles locaux ne valent pas CI, Sonar ou scans distants sur le nouveau SHA. Ils ne constituent pas une nouvelle recette audio ni une validation PO. Le rapport de livraison doit reprendre le SHA exact et les résultats distants effectifs.

## Réserves

Pilote Windows non signé, licence sous arbitrage PO, audio acquis 8/10 avec léger écho/chuintement. Réception et capture audio désactivées ; aucun appel réel supplémentaire. Aucun déploiement, aucun changement de preview ou base de recette. PR95 reste Draft/manual-po sans décision, label PO ni fusion par l'agent.
