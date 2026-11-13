# Entrées natives GENERAL PRE et POST v4

`scripts/ci/operational-driver-v4.mjs` est un nouveau point d'entrée explicite. Il ne modifie pas l'exécuteur historique PR282 et ne sélectionne jamais son journal `GENERAL UNKNOWN` ou `Ledger FIN`.

Les deux commandes ont la même forme, avec `general-pre-v4` ou `post-v4` après `image-only` :

```text
node scripts/ci/operational-driver-v4.mjs image-only <general-pre-v4|post-v4> \
  --objective-id <id-protégé> --objective-file <entrée-JSON-locale> \
  --dossier <dossier-JSON-exact> --jira-evidence <lecture-Jira-V2-fraîche> \
  --human-scope <reçu-humain-épinglé> --actor <acteur-observé> \
  --grant-digest <empreinte-du-grant-protégé> \
  --driver-root <checkout-PR282-propre> --adapter-root <checkout-PR294-propre> \
  --runner-root <checkout-du-runner-fusionné-propre> \
  --journal-dir <nouveau-répertoire-vierge-épinglé>
```

Node 22.23.3, sans `GIT_*`, `NODE_OPTIONS` ni `NODE_PATH`, est obligatoire pour la commande native. Chaque source est vérifiée dans son propre checkout : commit, arbre, état propre, fichiers suivis et SHA-256. Les 84 fichiers PR282 et les 11 fichiers PR294 sont épinglés exactement. L'entrée locale doit être identique à celle du catalogue protégé ; la preuve Jira V2 ne donne qu'une *readiness* de 600 secondes. Un objectif et un marqueur officiel distincts doivent autoriser explicitement `RUN` pour la phase, le job, l'UID, le dossier et le répertoire de journal.

Après deux lectures du job et des exécutions sans dérive d'UID/etag, la commande écrit un claim et une intention durables avant un unique `jobs.run`. En cas d'ambiguïté, le claim reste consommé : aucun retry. Une référence d'opération éventuellement reçue est préservée, mais la sortie de la commande déclare toujours `nativeOutputVerified=false`, `semanticComparisonVerified=false`, `sheetsActivated=false`. Ce dispatch ne constitue donc **ni** un PRE utilisable, **ni** une vérification POST, **ni** une autorisation de déploiement. Le rapprochement des sorties natives minimisées et le séquencement fermé sauvegarde → PRE → images → POST restent des étapes protégées distinctes, à qualifier avant toute activation Sheets.

Aucun objectif `cutoverNativeAuthoritiesV1` n'est ajouté par ce lot de code. Sa publication future doit être additive, liée au SHA fusionné du runner et à des journaux neufs ; aucun ancien objectif, marqueur, claim ou répertoire ne peut être réutilisé.
