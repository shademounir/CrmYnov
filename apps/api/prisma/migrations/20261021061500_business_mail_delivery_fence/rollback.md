# Repli du journal métier interne

Migration additive préparée et testée sur PostgreSQL synthétique isolé seulement.
Elle n'autorise aucun déploiement ni envoi. Aucun branchement AppModule, job,
outbox ou transport n'est inclus. L'analyseur statique des migrations doit aussi
accepter les instructions exactes avant toute fusion ; aucun marqueur ne remplace
ce contrôle et aucun garde-fou ne doit être affaibli pour publier ce lot.

Après un éventuel déploiement gouverné, le repli applicatif consiste à remettre les
images compatibles précédentes en laissant cette table additive et ses protections
en place. Les anciens binaires n'utilisent pas ce journal. Ne supprimer ni le journal,
ni une réservation SENDING, ni une issue ACCEPTED/UNCERTAIN pour provoquer un nouvel
envoi. Ne pas désactiver ses triggers. Toute réconciliation d'un envoi incertain
nécessite une décision distincte fondée sur une preuve fournisseur, sans renvoi automatique.

Avant repli : vérifier les opérations en vol, l'image, les flags et l'état réel du
transport ; terminer ou retenir les transactions. Préserver le job RC36 indépendant,
son Scheduler et les écritures ultérieures. Aucun rollback SQL destructif, seed,
restauration de base, réinitialisation d'invitations ou réémission historique.

Dans la fixture éphémère, arrêter le seul conteneur nonce créé par la recette ;
ne jamais employer cette procédure de nettoyage sur une base persistante.
