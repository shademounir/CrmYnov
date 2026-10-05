# CRMY-177 — reprise transactionnelle Sheets sous contention

## Défaut observé

Le contrôle de couverture de PR116, HEAD `25712a92ad3f7056fa7b60b8ecdb5f3e4f23e490`, a échoué avant toute analyse Sonar dans le cas PostgreSQL `LOCAL_ROW / EXTERNAL_ID concurrent distinct sources preserve one contact and two provenances` (`sheet-local-executor-postgres.test.ts`, assertion ligne 306).

Attendu : deux exécutions achevées, un seul Lead, deux provenances, deux reçus et deux audits ; une seule lecture externe par source. Réel : une exécution achevée et une erreur expurgée `sheet_execution_failed`. Le verrou de test était atteint ; deux conflits `P2034` étaient observés dans `persistSheetRecord`. Cette instrumentation ne couvre pas tous les lieux possibles d'échec de la transaction : elle ne prouve pas que seules deux tentatives ont eu lieu.

Le test, l'exécuteur, le coordinateur, le service d'ingestion et Prisma sont identiques dans `e154b4318e01005830cee81b3619e78cfcabd33f`, `c073d275257f31b4867910848112e2515fdcfcb1` et `25712a92ad3f7056fa7b60b8ecdb5f3e4f23e490`. Les résultats Sonar historiques de `c073…` ne couvrent pas le nouveau correctif.

## Correctif borné

Branche dédiée : `fix/CRMY-177-sheet-retry-contention-20261005`, base `e154b4318e01005830cee81b3619e78cfcabd33f`.

`retrySheetSerialization` conserve trois tentatives au maximum et ne reprend que le code Prisma `P2034`. Après le rejet complet d'une transaction, il attend 25 ms avant la deuxième tentative, puis 50 ms avant la troisième : 75 ms supplémentaires au maximum, hors transaction et hors verrou. Il ne transforme pas une erreur de droits, de bail, d'intégrité ou de transport en erreur récupérable.

Chaque tentative rappelle la transaction entière existante : fence de permissions, bail courant et autorité courante sont relus ; isolation Serializable et limites 10 s / 5 s sont conservées. Le callback ne contient que des opérations PostgreSQL. La lecture externe reste en amont et n'est pas rejouée. Aucun changement de schéma, de droits, de déduplication, d'affectation ou de configuration Sheets.

Cette attente constitue une mitigation bornée de contention, pas une garantie de réussite sous charge arbitraire. Après épuisement, l'erreur est toujours propagée et expurgée par l'exécuteur ; aucun faux succès n'est produit.

## Preuves et contrôles

- Node officiel 22.23.3 : 22 tests ciblés réussis, zéro échec et zéro skip (`sheet-serialization-retry`, `sheet-import-policy`, `sheet-import-authority`). Les huit nouveaux tests couvrent la minuterie réelle par défaut, les deux attentes, la limite de tentatives, les refus non récupérables, l'arrêt après révocation/perte de bail dans un callback rouvert et le raccordement source aux fences existants. Les callbacks unitaires ne constituent pas une preuve de concurrence PostgreSQL.
- Typage API `tsc --noEmit -p apps/api/tsconfig.json` et lint strict des trois fichiers TypeScript concernés : réussis. `git diff --check` : réussi. Aucune génération Prisma/shared ou installation de dépendances n'a été exécutée.
- Fixtures PostgreSQL existantes conservées, y compris la vraie course avec verrou et l'exigence de deux exécutions réussies : non réexécutées à la rédaction.
- Couverture canonique et CI sur le SHA final : à obtenir ; aucun seuil, filtre ou exclusion affaibli.
- Aucune base persistante ou DEV modifiée ; aucun connecteur Sheets activé, appel, mail, import réel, seed ou reset.

Commande ciblée, depuis la racine du worktree, avec le runtime Node officiel : `node --import tsx --test --test-concurrency=1 apps/api/test/sheet-serialization-retry.test.ts apps/api/test/sheet-import-policy.test.ts apps/api/test/sheet-import-authority.test.ts`.

La prochaine preuve PostgreSQL doit conserver les assertions et le verrou déterministe de la fixture existante. Elle doit utiliser uniquement un nouveau conteneur tmpfs, une image PostgreSQL vérifiée par digest, un nom et label nonce propres, une publication exclusivement loopback, un marqueur contrôlé et une base initialement vide `crmy171_synthetic`. Aucun réemploi des bases de recette conservées. Les deux cas de course peuvent être ciblés par `--test-name-pattern "concurrent distinct sources"` ; le premier scénario non ciblé sera alors explicitement ignoré dans cette preuve limitée. La couverture canonique existante continue de jouer le fichier complet sans filtre, ainsi que les autres intégrations requises, sur le SHA publié. Ne jamais présenter cette exécution limitée comme une campagne complète.

Le daemon Docker local ne répondant pas aux inspections CLI au moment de la préparation, aucune création ni exécution PostgreSQL locale n'a été tentée. Il n'est pas nécessaire de redémarrer ou arrêter globalement les services pour obtenir la preuve : la CI existante et son environnement jetable pourront la produire après publication technique autorisée.

## Retour arrière et limites

Le retour arrière applicatif remettrait les reprises immédiates précédentes ; il n'exige aucune migration ni restauration des données. Il réintroduirait toutefois le risque d'épuisement sous contention. Les effets d'une tentative annulée restent entièrement transactionnels ; les identifiants et reçus de déduplication existants sont préservés. Une preuve PostgreSQL isolée du cas réel reste nécessaire avant de déclarer le défaut résolu.
